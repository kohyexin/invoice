import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { round2 } from "@/lib/utils";

/* One-off: PANDAVCC paid USD 15,331.32 on 22 Jun 2026 for May and June, and the Excel used
   the excess on the July–October invoices. The import copied the sheet's working (-464.75 on
   June, 0 on the rest), so receipts were understated. This records it the way the app now
   handles overpayments: May and June paid from the payment, 6,875.70 kept as credit, July to
   October paid from that credit, 464.75 credit left.

     npx tsx --conditions=react-server scripts/fix-pandavcc-credit.ts            show what would change
     npx tsx --conditions=react-server scripts/fix-pandavcc-credit.ts --apply    save it */

const apply = process.argv.includes("--apply");
const actorName = "Script: fix-pandavcc-credit";
const DATE = new Date("2026-06-22T00:00:00.000Z");
const PAYMENT = 15331.32;
const FROM_PAYMENT = ["VH202600000028", "VH202600000031"];
const FROM_CREDIT = ["VH202600000034", "VH202600000037", "VH202600000043", "VH202600000046"];
const received = `USD 15,331.32 received 2026-06-22`;

async function main() {
  const numbers = [...FROM_PAYMENT, ...FROM_CREDIT];
  const invoices = await prisma.invoice.findMany({ where: { number: { in: numbers } } });
  if (invoices.length !== numbers.length || new Set(invoices.map((i) => i.clientId)).size !== 1) throw new Error("Expected the six PANDAVCC invoices for one client.");
  const byNumber = new Map(invoices.map((i) => [i.number, i]));
  const clientId = invoices[0].clientId;
  if (await prisma.clientCredit.count({ where: { clientId } })) {
    console.log("PANDAVCC already has credit entries; nothing to do.");
    return;
  }

  const paidNow = round2(FROM_PAYMENT.reduce((t, n) => t + Number(byNumber.get(n)!.amount), 0));
  const credit = round2(PAYMENT - paidNow);
  let balance = credit;
  console.log(`Payment ${PAYMENT} − May/June ${paidNow} = credit ${credit}`);

  const plan: { number: string; note: string; used: number }[] = [];
  for (const n of FROM_PAYMENT) plan.push({ number: n, note: `Part of ${received}`, used: 0 });
  for (const n of FROM_CREDIT) {
    const used = round2(Number(byNumber.get(n)!.amount));
    balance = round2(balance - used);
    plan.push({ number: n, note: "Paid from credit", used });
  }
  for (const p of plan) {
    const inv = byNumber.get(p.number)!;
    console.log(`${p.number} ${inv.amount}: received ${inv.receivedAmount} → ${inv.usdAmount}; note "${p.note}"${p.used ? `; credit −${p.used}` : ""}`);
  }
  console.log(`Credit left: USD ${balance}`);
  if (balance < 0) throw new Error("Credit would go below zero.");
  if (!apply) return console.log("\nDry run. Add --apply to save.");

  await prisma.$transaction(async (tx) => {
    await tx.clientCredit.create({ data: { clientId, currency: "USD", amount: credit, date: DATE, note: `Left over from ${received}` } });
    for (const p of plan) {
      const inv = byNumber.get(p.number)!;
      const after = { status: "PAID" as const, receivedDate: DATE, receivedAmount: round2(Number(inv.usdAmount)), receivedCurrency: null, paymentNote: p.note };
      await tx.invoice.update({ where: { id: inv.id }, data: after });
      if (p.used) await tx.clientCredit.create({ data: { clientId, currency: "USD", amount: -p.used, date: DATE, invoiceId: inv.id, note: `Used on ${inv.number}` } });
      await tx.activityLog.create({ data: { actorName, action: "update", entity: "invoice", entityId: inv.id, label: inv.number, changes: diff(inv, after) as object } });
    }
    await tx.activityLog.create({
      data: { actorName, action: "update", entity: "client", entityId: clientId, label: "Credit", changes: { currency: "USD", payment: PAYMENT, creditAdded: credit, creditUsed: round2(credit - balance) } },
    });
  });
  console.log("Saved.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
