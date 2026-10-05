/* Reads the fields the ledger needs from a STAR SAAS billing-system invoice
   (the PDF emailed on the 1st, e.g. "Invoice on Circlepayment / 01-Sep-2026").
   Two layouts exist:
   - SI invoices: "Client Name: ArtfulPay", dates like 01-Sep-2026, "GRAND TOTAL(USD)".
   - VH invoices: legal name under "Billed to", one row holding number, reference,
     issue and due date (01/10/2026), period "01-09-2026 to 30-09-2026". */

export type SystemInvoice = {
  number: string;
  reference: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string;
  amount: number;
  /** USD total printed next to a non-USD amount due; null when only one currency is printed. */
  usdAmount?: number | null;
};

const MON: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "01-Sep-2026", "01/09/2026" or "01-09-2026" (day first) → "2026-09-01" */
function isoDate(s: string | undefined) {
  const m = s?.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (m) {
    const mm = MON[m[2].toLowerCase()];
    return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
  }
  const n = s?.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!n || Number(n[2]) < 1 || Number(n[2]) > 12) return null;
  return `${n[3]}-${n[2].padStart(2, "0")}-${n[1].padStart(2, "0")}`;
}

const DATE = String.raw`\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}`;

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ""));

export function parseSystemInvoiceText(raw: string): { ok: true; invoice: SystemInvoice } | { ok: false; error: string; partial: Partial<SystemInvoice> } {
  const text = raw.replace(/\r/g, "").replace(/[ \t\u00a0]+/g, " ");

  // VH layout: "Invoice Number Reference Date of Issue Due Date" header, values on the next row.
  const row = text.match(
    new RegExp(String.raw`Invoice Number\s+Reference\s+Date of Issue\s+Due Date\s*\n\s*([A-Z]{2,4}\d{6,})\s+(\S+)\s+(${DATE})\s+(${DATE})`, "i")
  );

  const number = row?.[1] ?? text.match(/\b(SI\d{6,})\b/)?.[1] ?? "";
  const reference = (row && /^[A-Z]{2,5}-\d{6,}$/.test(row[2]) ? row[2] : undefined) ?? text.match(/\b([A-Z]{2,5}-\d{6,})\b/)?.[1] ?? "";
  const clientName =
    text.match(/Client Name:\s*([^\n]+?)\s*(?:\n|Category|$)/i)?.[1]?.trim() ??
    (row ? text.match(/Billed to:?\s*\n\s*([^\n]+)/i)?.[1]?.trim() : undefined) ??
    "";
  const currency = text.match(/Amount Due \(([A-Z]{3})\)/i)?.[1]?.toUpperCase() ?? text.match(/GRAND TOTAL\s*\(([A-Z]{3})\)/i)?.[1]?.toUpperCase() ?? "USD";

  // Lines are priced in USD; an invoice due in CNY prints both "GRAND TOTAL(USD)" and
  // "GRAND TOTAL(CNY)". The amount is the total in the amount-due currency, the USD one its booked value.
  const totals = new Map<string, string>();
  for (const m of text.matchAll(/GRAN[DT] TOTAL\s*(?:\(([A-Z]{3})\))?\s*[$¥€]?\s*([\d,]+\.\d{2})/gi)) {
    const cur = (m[1] ?? "").toUpperCase();
    if (!totals.has(cur)) totals.set(cur, m[2]);
  }
  const grand = totals.get(currency) ?? totals.get("") ?? (currency === "USD" ? [...totals.values()][0] : undefined);
  const afterNumber = number ? text.slice(text.indexOf(number) + number.length).match(/^\s*[$¥€]?\s*([\d,]+\.\d{2})/)?.[1] : undefined;
  const amountDue = text.match(/Amount Due \([A-Z]{3}\)\s*[$¥€]?\s*([\d,]+\.\d{2})/i)?.[1];
  const amountText = grand ?? afterNumber ?? amountDue;
  const usdText = currency !== "USD" ? totals.get("USD") : undefined;

  const period = text.match(new RegExp(String.raw`billing period from\s+(${DATE})\s+to\s+(${DATE})`, "i"));
  // SI layout: issue date sits on the same row as the invoice number; due date follows "Due Date".
  const issue = row?.[3] ?? (number ? text.slice(0, text.indexOf(number)).match(/(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/)?.[1] : undefined);
  const dates = [...text.matchAll(/\b\d{1,2}-[A-Za-z]{3}-\d{4}\b/g)].map((m) => m[0]);
  const periodDates = new Set(period ? [period[1], period[2]] : []);
  const loose = dates.filter((d) => !periodDates.has(d));
  const due = row?.[4] ?? text.match(/Due Date[\s\S]{0,40}?(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] ?? loose[1];

  const partial: Partial<SystemInvoice> = {
    number,
    reference,
    clientName,
    currency,
    invoiceDate: isoDate(issue ?? loose[0]) ?? undefined,
    dueDate: isoDate(due),
    periodFrom: isoDate(period?.[1]),
    periodTo: isoDate(period?.[2]),
    amount: amountText ? money(amountText) : undefined,
    usdAmount: usdText ? money(usdText) : null,
  };

  const missing = [!number && "invoice number", !partial.invoiceDate && "issue date", partial.amount === undefined && "amount"].filter(Boolean);
  if (missing.length) return { ok: false, error: `Could not read ${missing.join(", ")} from the PDF.`, partial };
  return { ok: true, invoice: partial as SystemInvoice };
}

export async function extractPdfText(data: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
