import "dotenv/config";
import ExcelJS from "exceljs";
import { PrismaClient, type Currency, type InvoiceStatus } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { clientData, parseLooseDate, toClientDraft } from "../lib/client-import";

/* One-time import of "Star SaaS Client Invoice Repayment Status v2.0.xlsm".

     npm run import:workbook -- "docs/Star SaaS Client Invoice Repayment Status v2.0.xlsm" --dry-run
     npm run import:workbook -- "docs/Star SaaS Client Invoice Repayment Status v2.0.xlsm"

   Brings in Client DB and Invoice List. Left behind on purpose: the Month
   column and list, row numbers (kept only as legacyNo for tracing), the
   pivot, Type helper columns and the invoice template sheets.
   Re-running updates rows that match by the No. column. */

const file = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!file) {
  console.error('Usage: npm run import:workbook -- "<path to .xlsm>" [--dry-run]');
  process.exit(1);
}

const CURRENCY_ALIASES: Record<string, Currency> = {
  USD: "USD",
  HKD: "HKD",
  CNY: "CNY",
  RMB: "CNY",
  CNH: "CNY",
  EUR: "EUR",
  SGD: "SGD",
};

const STATUS: Record<string, InvoiceStatus> = {
  PAID: "PAID",
  SENT: "SENT",
  END: "END",
  LOST: "LOST",
  WAIVED: "WAIVED",
};

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    if ("result" in (v as object)) return (v as { result: unknown }).result;
    if ("richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if ("text" in (v as object)) return (v as { text: unknown }).text;
    if (v instanceof Date) return v;
    if ("error" in (v as object)) return null;
  }
  return v;
}

function str(cell: ExcelJS.Cell) {
  const v = cellValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, " ").trim();
}

function num(cell: ExcelJS.Cell): number | null {
  const v = cellValue(cell);
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function noteText(cell: ExcelJS.Cell): string {
  const note = cell.note as unknown;
  if (!note) return "";
  if (typeof note === "string") return note;
  const texts = (note as { texts?: { text: string }[] }).texts ?? [];
  return texts.map((t) => t.text).join("");
}

/** "Robin Koh:\nCNY 110,000" → { currency: CNY, amount: 110000, text: "CNY 110,000" } */
function parseNote(raw: string) {
  const text = raw.replace(/^[^:\n]{1,40}:\s*/, "").replace(/\s+/g, " ").trim();
  const m = text.match(/\b(USD|HKD|CNY|RMB|CNH|EUR|SGD)\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  const currency = CURRENCY_ALIASES[(m?.[1] ?? text.match(/\b(HKD|CNY|RMB|EUR|SGD)\b/i)?.[1] ?? "").toUpperCase()];
  const amount = m ? Number(m[2].replace(/,/g, "")) : null;
  return { text, currency: currency ?? null, amount };
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  /* ------------------------------ Clients ----------------------------- */
  const clientSheet = wb.getWorksheet("Client DB");
  if (!clientSheet) throw new Error('Sheet "Client DB" not found');
  const headers: string[] = [];
  clientSheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = str(cell);
  });
  const clientDrafts = [];
  for (let r = 2; r <= clientSheet.rowCount; r++) {
    const row = clientSheet.getRow(r);
    const record: Record<string, unknown> = {};
    headers.forEach((h, col) => {
      if (h) record[h] = cellValue(row.getCell(col));
    });
    const draft = toClientDraft(record);
    if (draft) clientDrafts.push(draft);
  }

  /* ---------------------------- Invoice List --------------------------- */
  const list = wb.getWorksheet("Invoice List");
  if (!list) throw new Error('Sheet "Invoice List" not found');

  type Parsed = {
    legacyNo: number;
    client: string;
    alias: string;
    owner: string;
    type: string;
    subtype: string;
    generate: "SYSTEM" | "MANUAL";
    status: InvoiceStatus;
    invoiceDate: Date;
    number: string;
    usdAmount: number;
    currency: Currency;
    amount: number;
    fxRate: number | null;
    receivedDate: Date | null;
    receivedAmount: number | null;
    receivedCurrency: Currency | null;
    fee: number | null;
    paymentNote: string;
    notes: string;
  };

  const invoices: Parsed[] = [];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  const legacyNos = new Map<number, number>();
  const counts = { types: new Map<string, number>(), generate: new Map<string, number>(), status: new Map<string, number>(), owners: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (let r = 7; r <= list.rowCount; r++) {
    const row = list.getRow(r);
    const client = str(row.getCell(2));
    const numberRaw = str(row.getCell(11));
    if (!client && !numberRaw) continue;

    const rawType = str(row.getCell(5));
    const type = rawType === "WL & Server" ? "Whitelabel" : rawType;
    const rawGenerate = str(row.getCell(7));
    const rawStatus = str(row.getCell(8)).toUpperCase();
    bump(counts.types, rawType || "(blank)");
    bump(counts.generate, rawGenerate || "(blank)");
    bump(counts.status, rawStatus || "(blank)");
    bump(counts.owners, str(row.getCell(4)) || "(blank)");

    const invoiceDate = parseLooseDate(cellValue(row.getCell(10)));
    const usdAmount = num(row.getCell(12)) ?? 0;
    const status = STATUS[rawStatus];
    if (!client || !numberRaw || !invoiceDate || !status) {
      problems.push(
        `Row ${r}: skipped (${[!client && "no client", !numberRaw && "no invoice no", !invoiceDate && "no date", !status && `status "${rawStatus}"`].filter(Boolean).join(", ")})`
      );
      continue;
    }
    if (num(row.getCell(12)) === null) problems.push(`Row ${r}: ${numberRaw} ${client} (${rawStatus}) has no amount; imported as 0`);

    const number = numberRaw;
    seen.set(number, (seen.get(number) ?? 0) + 1);
    const legacyNo = num(row.getCell(1)) ?? r;
    if (legacyNos.has(legacyNo)) {
      problems.push(`Row ${r}: No. ${legacyNo} repeats row ${legacyNos.get(legacyNo)}; skipped`);
      continue;
    }
    legacyNos.set(legacyNo, r);

    const amountNote = parseNote(noteText(row.getCell(12)));
    const receivedNote = parseNote(noteText(row.getCell(14)));
    const hasOriginal = amountNote.currency && amountNote.currency !== "USD" && amountNote.amount;

    invoices.push({
      legacyNo,
      client,
      alias: str(row.getCell(3)).toUpperCase(),
      owner: str(row.getCell(4)),
      type,
      subtype: str(row.getCell(6)),
      // Adhoc and VCC were manual invoices; only System stays System.
      generate: rawGenerate.toLowerCase() === "system" ? "SYSTEM" : "MANUAL",
      status,
      invoiceDate,
      number,
      usdAmount,
      currency: hasOriginal ? amountNote.currency! : "USD",
      amount: hasOriginal ? amountNote.amount! : usdAmount,
      fxRate: hasOriginal ? usdAmount / amountNote.amount! : null,
      receivedDate: parseLooseDate(cellValue(row.getCell(13))),
      receivedAmount: num(row.getCell(14)),
      receivedCurrency: receivedNote.currency,
      fee: num(row.getCell(15)),
      paymentNote: receivedNote.text,
      notes: amountNote.text && !hasOriginal ? amountNote.text : "",
    });
  }

  /* ------------------------------ Report ------------------------------- */
  const show = (label: string, m: Map<string, number>) =>
    console.log(`${label}: ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  console.log(`Client DB rows: ${clientDrafts.length}`);
  console.log(`Invoice List rows to import: ${invoices.length}`);
  show("Types", counts.types);
  show("Generate", counts.generate);
  show("Status", counts.status);
  show("Owners", counts.owners);
  console.log(`Non-USD invoices from amount notes: ${invoices.filter((i) => i.currency !== "USD").length}`);
  const reused = [...seen.values()].filter((n) => n > 1);
  console.log(`Invoice numbers on more than one row: ${reused.length} (${reused.reduce((s, n) => s + n, 0)} rows)`);
  const known = new Set(clientDrafts.map((d) => d.name));
  const missing = [...new Set(invoices.map((i) => i.client))].filter((c) => !known.has(c));
  console.log(`Invoice clients not in Client DB (created with name only): ${missing.length}`);
  if (problems.length) {
    console.log(`\n${problems.length} notes:`);
    problems.slice(0, 60).forEach((p) => console.log(`  ${p}`));
    if (problems.length > 60) console.log(`  … ${problems.length - 60} more`);
  }
  if (dryRun) {
    console.log("\nDry run: nothing written.");
    return;
  }

  /* ------------------------------ Write -------------------------------- */
  const clientIds = new Map<string, string>();
  for (const d of clientDrafts) {
    const jotformTaken = d.jotformId && (await prisma.client.findFirst({ where: { jotformId: d.jotformId, NOT: { name: d.name } } }));
    const row = await prisma.client.upsert({
      where: { name: d.name },
      update: { ...clientData(d), jotformId: jotformTaken ? undefined : d.jotformId ?? undefined },
      create: { name: d.name, ...clientData(d), jotformId: jotformTaken ? undefined : d.jotformId ?? undefined },
    });
    clientIds.set(d.name, row.id);
  }
  for (const name of missing) {
    const row = await prisma.client.upsert({ where: { name }, update: {}, create: { name } });
    clientIds.set(name, row.id);
  }

  const ownerIds = new Map<string, string>();
  for (const name of new Set(invoices.map((i) => i.owner).filter(Boolean))) {
    const row = await prisma.owner.upsert({ where: { name }, update: {}, create: { name } });
    ownerIds.set(name, row.id);
  }
  const typeIds = new Map<string, string>();
  for (const name of new Set(invoices.map((i) => i.type).filter(Boolean))) {
    const row = await prisma.invoiceType.upsert({ where: { name }, update: {}, create: { name } });
    typeIds.set(name, row.id);
  }

  let written = 0;
  for (const inv of invoices) {
    const data = {
      clientId: clientIds.get(inv.client)!,
      alias: inv.alias,
      ownerId: inv.owner ? ownerIds.get(inv.owner) ?? null : null,
      typeId: inv.type ? typeIds.get(inv.type) ?? null : null,
      subtype: inv.subtype,
      generate: inv.generate,
      status: inv.status,
      invoiceDate: inv.invoiceDate,
      currency: inv.currency,
      amount: inv.amount,
      usdAmount: inv.usdAmount,
      fxRate: inv.fxRate,
      receivedDate: inv.receivedDate,
      receivedAmount: inv.receivedAmount,
      receivedCurrency: inv.receivedCurrency,
      fee: inv.fee,
      paymentNote: inv.paymentNote,
      notes: inv.notes,
      legacyNo: inv.legacyNo,
    };
    await prisma.invoice.upsert({
      where: { legacyNo: inv.legacyNo },
      update: { number: inv.number, ...data },
      create: { number: inv.number, ...data },
    });
    written++;
    if (written % 250 === 0) console.log(`  ${written} invoices written…`);
  }

  // Alias and default owner on each client come from its latest invoice.
  const latest = new Map<string, Parsed>();
  for (const inv of invoices) {
    const cur = latest.get(inv.client);
    if (!cur || inv.invoiceDate >= cur.invoiceDate) latest.set(inv.client, inv);
  }
  for (const [name, inv] of latest) {
    const client = await prisma.client.findUnique({ where: { name }, select: { id: true, alias: true, defaultOwnerId: true } });
    if (!client) continue;
    await prisma.client.update({
      where: { id: client.id },
      data: {
        alias: client.alias || inv.alias,
        defaultOwnerId: client.defaultOwnerId ?? (inv.owner ? ownerIds.get(inv.owner) : undefined),
      },
    });
  }

  console.log(`\nImported ${clientIds.size} clients and ${written} invoices.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
