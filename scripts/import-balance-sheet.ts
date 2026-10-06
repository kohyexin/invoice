import "dotenv/config";
import ExcelJS from "exceljs";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CASH_ACCOUNTS, CASH_CATEGORIES, MOONLINK } from "../lib/cash-seed";

/* Import of "Star SaaS Balance Sheet 2.0.xlsx" into the cash book.

     npm run import:balance -- "docs/Star SaaS Balance Sheet 2.0.xlsx" --dry-run
     npm run import:balance -- "docs/Star SaaS Balance Sheet 2.0.xlsx"

   Reads the live bank sheets listed in lib/cash-seed.ts. Dashboard, Monthly,
   Accounts, Pivot and Term are worked out by the app instead; the S-, Others
   and Jason sheets are closed. The per-row USD columns are not imported:
   USD is worked out on totals with the latest rate.
   Re-running replaces the lines that came from each sheet; lines entered in
   the app are kept. */

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file) {
  console.error('Usage: npm run import:balance -- "<path to .xlsx>" [--dry-run]');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

/** Fullwidth ￥ and ¥ are both used in sheet names. */
const sheetKey = (name: string) => name.replace(/￥/g, "¥").trim();

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v instanceof Date) return v;
  if (v && typeof v === "object") {
    if ("result" in (v as object)) return (v as { result: unknown }).result;
    if ("richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in (v as object)) return (v as { text: unknown }).text;
    return null;
  }
  return v;
}

function str(cell: ExcelJS.Cell) {
  const v = cellValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

function num(cell: ExcelJS.Cell) {
  const v = cellValue(cell);
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Real dates, or text such as 2025-01-24 (about 280 rows in XMXY - ¥). */
function date(cell: ExcelJS.Cell): Date | null {
  const v = cellValue(cell);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const m = typeof v === "string" ? v.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/) : null;
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** 使用月 as the first of its month: a date, 2024-07(-01) or Jul 2024. Falls back to the line date's month. */
function period(cell: ExcelJS.Cell, fallback: Date): Date {
  const v = cellValue(cell);
  const first = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  if (v instanceof Date && !Number.isNaN(v.getTime())) return first(v.getUTCFullYear(), v.getUTCMonth());
  if (typeof v === "string") {
    const iso = v.trim().match(/^(\d{4})[-/](\d{1,2})/);
    if (iso) return first(+iso[1], +iso[2] - 1);
    const named = v.trim().toLowerCase().match(/^([a-z]{3})[a-z]*[\s-]+(\d{4})$/);
    if (named && MONTHS.includes(named[1])) return first(+named[2], MONTHS.indexOf(named[1]));
  }
  return first(fallback.getUTCFullYear(), fallback.getUTCMonth());
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = new Map(wb.worksheets.map((ws) => [sheetKey(ws.name), ws]));

  // Settings: Moonlink, categories and accounts. Existing values are left as they are.
  const companies = new Map<string, string>();
  for (const c of await prisma.company.findMany()) companies.set(c.code, c.id);
  if (!companies.has(MOONLINK.code) && !dryRun) {
    const count = await prisma.company.count();
    const row = await prisma.company.create({ data: { ...MOONLINK, termsEn: [], termsZh: [], sortOrder: count } });
    companies.set(row.code, row.id);
  }

  if (!dryRun) {
    for (const [i, [nameZh, nameEn, kind]] of CASH_CATEGORIES.entries()) {
      await prisma.cashCategory.upsert({ where: { nameZh }, update: {}, create: { nameZh, nameEn, kind, sortOrder: i } });
    }
  }
  const categories = new Map((await prisma.cashCategory.findMany()).map((c) => [c.nameZh, c.id]));

  const invoices = await prisma.invoice.findMany({ select: { id: true, number: true, invoiceDate: true } });
  const byNumber = new Map<string, { id: string; invoiceDate: Date }[]>();
  for (const inv of invoices) {
    const key = inv.number.trim().toUpperCase();
    if (key) (byNumber.get(key) ?? byNumber.set(key, []).get(key)!).push(inv);
  }
  /** An invoice number in the Paid Invoice or 发票号码 text; the latest one issued on or before the payment. */
  const findInvoice = (texts: string[], on: Date) => {
    for (const token of texts.join(" ").toUpperCase().split(/[^A-Z0-9-]+/)) {
      const hits = token.length >= 6 ? byNumber.get(token) : undefined;
      if (!hits) continue;
      const before = hits.filter((h) => h.invoiceDate <= on).sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime());
      return (before[0] ?? hits[0]).id;
    }
    return null;
  };

  const maxSort = (await prisma.bankAccount.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  const report: string[][] = [];
  let mismatches = 0;

  for (const [i, acc] of CASH_ACCOUNTS.entries()) {
    const ws = sheets.get(sheetKey(acc.sheet));
    if (!ws) throw new Error(`Sheet "${acc.sheet}" not found in the workbook.`);

    type Line = {
      date: Date;
      period: Date;
      seq: number;
      categoryId: string | null;
      purpose: string;
      party: string;
      memo: string;
      amountIn: number;
      amountOut: number;
      invoiceId: string | null;
      sourceRow: number;
    };
    const lines: Line[] = [];
    let workbookBalance: number | null = null;
    let skipped = 0;
    const unknownCategories = new Set<string>();

    ws.eachRow((row, r) => {
      if (r < 5) return;
      const d = date(row.getCell(1));
      const amountOut = num(row.getCell(9));
      const amountIn = num(row.getCell(10));
      if (!d) {
        if (amountIn || amountOut) skipped++;
        return;
      }
      // The balance column as last calculated by Excel on this row; blank when never recalculated.
      const balance = cellValue(row.getCell(11));
      workbookBalance = typeof balance === "number" ? balance : null;
      if (!amountIn && !amountOut) return;
      const cat = str(row.getCell(3));
      if (cat && !categories.has(cat)) unknownCategories.add(cat);
      const party = str(row.getCell(5));
      const memo = str(row.getCell(6));
      lines.push({
        date: d,
        period: period(row.getCell(7), d),
        seq: r,
        categoryId: categories.get(cat) ?? null,
        purpose: str(row.getCell(4)),
        party,
        memo,
        amountIn,
        amountOut,
        invoiceId: findInvoice([party, memo], d),
        sourceRow: r,
      });
    });

    const computed = Math.round(lines.reduce((s, l) => s + l.amountIn - l.amountOut, 0) * 100) / 100;
    const wbBal = workbookBalance === null ? null : Math.round((workbookBalance as number) * 100) / 100;
    const ok = wbBal === null || Math.abs(computed - wbBal) < 0.01;
    if (!ok) mismatches++;
    report.push([
      acc.sheet,
      acc.label,
      String(lines.length),
      computed.toFixed(2),
      wbBal === null ? "—" : wbBal.toFixed(2),
      ok ? "ok" : "DIFFERS",
      String(lines.filter((l) => l.invoiceId).length),
      String(lines.filter((l) => l.period.getUTCMonth() !== l.date.getUTCMonth() || l.period.getUTCFullYear() !== l.date.getUTCFullYear()).length),
      skipped ? `${skipped} undated` : "",
      unknownCategories.size ? `unknown: ${[...unknownCategories].join(", ")}` : "",
    ]);
    if (dryRun) continue;

    const companyId = companies.get(acc.company) ?? null;
    let account = await prisma.bankAccount.findUnique({ where: { label: acc.label } });
    if (acc.existing) {
      if (!account) throw new Error(`Bank account "${acc.label}" not found in Settings.`);
      account = await prisma.bankAccount.update({
        where: { id: account.id },
        data: { use: account.use === "INVOICE" ? "BOTH" : account.use, companyId: account.companyId ?? companyId },
      });
    } else if (!account) {
      account = await prisma.bankAccount.create({
        data: {
          label: acc.label,
          currency: acc.currency,
          accountName: acc.accountName,
          accountNumber: "",
          bankName: acc.bankName,
          use: "BALANCE",
          companyId,
          sortOrder: maxSort + 1 + i,
        },
      });
    }

    const accountId = account.id;
    await prisma.$transaction([
      prisma.cashTxn.deleteMany({ where: { sourceSheet: acc.sheet } }),
      prisma.cashTxn.createMany({ data: lines.map((l) => ({ ...l, accountId, sourceSheet: acc.sheet })) }),
    ]);
  }

  const head = ["Sheet", "Account", "Lines", "Recomputed", "Workbook", "Check", "Invoices linked", "Other month", "", ""];
  const widths = head.map((h, c) => Math.max(h.length, ...report.map((r) => r[c].length)));
  for (const r of [head, ...report]) console.log(r.map((v, c) => v.padEnd(widths[c])).join("  ").trimEnd());
  console.log(dryRun ? "\nDry run: nothing written." : "\nImported.");
  if (mismatches) console.log(`${mismatches} account(s) differ from the workbook's last balance.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
