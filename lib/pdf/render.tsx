import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/db";
import { billToFromClient, type BillTo } from "@/lib/bill-to";
import { formatDate, round2 } from "@/lib/utils";
import { InvoicePdf, type InvoicePdfData, type PdfAccount } from "./invoice-pdf";

let fontsReady: Promise<void> | null = null;
function ensureFonts() {
  fontsReady ??= (async () => {
    const dir = path.join(process.cwd(), "assets", "fonts");
    Font.register({
      family: "NotoSansSC",
      fonts: [
        { src: path.join(dir, "NotoSansSC-Regular.ttf"), fontWeight: 400 },
        { src: path.join(dir, "NotoSansSC-Bold.ttf"), fontWeight: 700 },
      ],
    });
    // Latin words stay whole; CJK runs may break between any two characters.
    Font.registerHyphenationCallback((word) => (/[\u3000-\u9fff\uff00-\uffef]/.test(word) ? Array.from(word) : [word]));
    // react-pdf sets each line's baseline at its tallest font's ascent. Noto's is ~30% taller than
    // Helvetica's, so without this any line containing Chinese sits lower than its row.
    for (const fontWeight of [400, 700]) {
      const source = Font.getFont({ fontFamily: "NotoSansSC", fontWeight });
      await source?.load();
      if (source?.data) Object.defineProperty(source.data, "ascent", { value: source.data.unitsPerEm * 0.9 });
    }
  })();
  return fontsReady;
}

/** Everything needed to print an invoice, saved or not. */
export type InvoiceDraft = {
  companyId: string;
  language: "EN" | "ZH";
  billTo: BillTo;
  number: string;
  reference: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  lines: { description: string; detail: string; rate: number; quantity: number }[];
  taxAmount: number;
  amountPaid: number;
  altCurrency: string | null;
  altAmount: number | null;
  bankAccountId: string | null;
  extraAccountIds: string[];
};

async function readLogo(logoPath: string | null) {
  if (!logoPath) return null;
  try {
    return await fs.readFile(path.join(process.cwd(), "public", logoPath.replace(/^\/+/, "")));
  } catch {
    return null;
  }
}

const toAccount = (a: {
  label: string;
  currency: string;
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankAddress: string;
  bankCode: string;
  branchCode: string;
  swiftCode: string;
  accountLocation: string;
}): PdfAccount => ({
  label: a.label,
  currency: a.currency,
  accountName: a.accountName,
  accountNumber: a.accountNumber,
  bankName: a.bankName,
  bankAddress: a.bankAddress,
  bankCode: a.bankCode,
  branchCode: a.branchCode,
  swiftCode: a.swiftCode,
  accountLocation: a.accountLocation,
});

export async function pdfDataFromDraft(d: InvoiceDraft): Promise<InvoicePdfData> {
  const [company, accounts] = await Promise.all([
    prisma.company.findUnique({ where: { id: d.companyId } }),
    prisma.bankAccount.findMany({ where: { id: { in: [d.bankAccountId, ...d.extraAccountIds].filter((x): x is string => Boolean(x)) } } }),
  ]);
  if (!company) throw new Error("Issuer not found");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const lines = d.lines.map((l) => ({ ...l, amount: round2(l.rate * l.quantity) }));
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const main = d.bankAccountId ? byId.get(d.bankAccountId) : undefined;

  return {
    lang: d.language,
    issuer: { name: company.legalName, addressLines: company.addressLines, logo: await readLogo(company.logoPath) },
    billTo: d.billTo,
    number: d.number,
    reference: d.reference,
    invoiceDate: formatDate(d.invoiceDate),
    dueDate: d.dueDate ? formatDate(d.dueDate) : "",
    currency: d.currency,
    lines,
    subtotal,
    tax: d.taxAmount,
    total: round2(subtotal + d.taxAmount),
    amountPaid: d.amountPaid,
    alt: d.altCurrency && d.altAmount !== null ? { currency: d.altCurrency, amount: d.altAmount } : null,
    terms: d.language === "ZH" ? company.termsZh : company.termsEn,
    account: main ? toAccount(main) : null,
    extraAccounts: d.extraAccountIds.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => Boolean(a)).map(toAccount),
  };
}

export async function renderInvoicePdf(data: InvoicePdfData) {
  await ensureFonts();
  return renderToBuffer(<InvoicePdf data={data} />);
}

/** Draft for a saved manual invoice, or null when it has nothing to print. */
export async function draftForInvoice(id: string): Promise<InvoiceDraft | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, client: true },
  });
  if (!inv || !inv.companyId || inv.lines.length === 0) return null;
  return {
    companyId: inv.companyId,
    language: inv.language,
    billTo: (inv.billTo as BillTo | null) ?? billToFromClient(inv.client),
    number: inv.number,
    reference: inv.reference,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    lines: inv.lines.map((l) => ({ description: l.description, detail: l.detail, rate: Number(l.rate), quantity: Number(l.quantity) })),
    taxAmount: Number(inv.taxAmount),
    amountPaid: Number(inv.amountPaid),
    altCurrency: inv.altCurrency,
    altAmount: inv.altAmount === null ? null : Number(inv.altAmount),
    bankAccountId: inv.bankAccountId,
    extraAccountIds: inv.extraAccountIds,
  };
}

export function pdfFilename(alias: string, number: string) {
  return `${(alias || "Invoice").replace(/[^\w.-]+/g, "_")}_Invoice ${number}.pdf`;
}
