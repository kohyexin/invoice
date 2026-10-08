import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { settleInvoices } from "@/lib/statements/invoices";

/* One-off: the first XMXY import suggested invoice numbers from the payer's earlier
   payments instead of the unpaid invoice for the same amount.
     - 16 Sep 28,048.99 (approved as SI2600002005) → SI2600002123, linked and marked paid
     - 30 Sep 36,223.32 (waiting for approval) → suggests SI2600002138

     npx tsx --conditions=react-server scripts/fix-xmxy-invoices.ts            show what would change
     npx tsx --conditions=react-server scripts/fix-xmxy-invoices.ts --apply    save it */

const apply = process.argv.includes("--apply");
const actorName = "Script: fix-xmxy-invoices";
const PREFIX = "CIB:129960100100474016:CNY:2026-09:ref:";
const APPROVED = { key: `${PREFIX}20260916003487642600002`, number: "SI2600002123" };
const WAITING = { key: `${PREFIX}20260930026323954800002`, number: "SI2600002138" };

async function invoiceOf(number: string) {
  const inv = await prisma.invoice.findFirst({ where: { number }, select: { id: true, status: true, alias: true, amount: true, currency: true } });
  if (!inv) throw new Error(`${number} not found`);
  return inv;
}

async function main() {
  // Approved line: correct the cash book entry, then link and settle like approval now does.
  const txn = await prisma.cashTxn.findUnique({ where: { importKey: APPROVED.key } });
  const inv = await invoiceOf(APPROVED.number);
  if (!txn) console.log("16 Sep line: not in the cash book, skipped");
  else if (txn.party === APPROVED.number && txn.invoiceId) console.log("16 Sep line: already fixed");
  else {
    console.log(`16 Sep ${txn.amountIn}: party "${txn.party}" → "${APPROVED.number}"; invoice ${inv.status} ${inv.currency} ${inv.amount} → link and mark paid`);
    if (apply) {
      const settled = await prisma.$transaction(async (tx) => {
        await tx.cashTxn.update({ where: { id: txn.id }, data: { party: APPROVED.number } });
        await tx.statementLine.updateMany({ where: { key: APPROVED.key }, data: { party: APPROVED.number } });
        await tx.cashHint.updateMany({ where: { accountId: txn.accountId, party: txn.party, direction: "in" }, data: { party: APPROVED.number } });
        return settleInvoices(tx, { id: txn.id, accountId: txn.accountId, date: txn.date, party: APPROVED.number, amountIn: Number(txn.amountIn) }, { markPaid: true, actorId: null });
      });
      await prisma.activityLog.create({
        data: { actorName, action: "update", entity: "cash_entry", entityId: txn.id, label: `${txn.date.toISOString().slice(0, 10)} · ${txn.purpose}`, changes: diff(txn, { party: APPROVED.number, invoiceId: inv.id }) as object },
      });
      for (const s of settled) {
        await prisma.activityLog.create({ data: { actorName, action: "mark_paid", entity: "invoice", entityId: s.id, label: s.number, changes: diff(s.before, s.after) as object } });
      }
      console.log(`  linked; marked paid: ${settled.map((s) => s.number).join(", ") || "none"}`);
    }
  }

  // Waiting line: replace the suggestion.
  const line = await prisma.statementLine.findUnique({ where: { key: WAITING.key } });
  const next = await invoiceOf(WAITING.number);
  if (!line || line.status !== "PENDING") console.log("30 Sep line: not waiting for approval, skipped");
  else if (line.party === WAITING.number) console.log("30 Sep line: already fixed");
  else {
    const data = { party: WAITING.number, memo: next.alias || line.memo, suggested: "invoice" };
    console.log(`30 Sep ${line.amountIn}: party "${line.party}" → "${data.party}", memo "${line.memo}" → "${data.memo}"`);
    if (apply) {
      await prisma.statementLine.update({ where: { id: line.id }, data });
      await prisma.activityLog.create({
        data: { actorName, action: "update", entity: "statement_line", entityId: line.id, label: `${line.date.toISOString().slice(0, 10)} +${line.amountIn}`, changes: diff(line, data) as object },
      });
    }
  }
  if (!apply) console.log("\nDry run. Add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
