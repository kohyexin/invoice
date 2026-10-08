import "dotenv/config";
import { prisma } from "@/lib/db";

/* Merge the Industrial Bank invoice accounts (IBC Bank) into the XMXY cash accounts, renamed
   USD/CNY (兴业银行), used for both invoices and the balance sheet. EUR (IBC Bank) was never used.

     npx tsx --conditions=react-server scripts/merge-xmxy-accounts.ts            show what would change
     npx tsx --conditions=react-server scripts/merge-xmxy-accounts.ts --apply    save it */

const apply = process.argv.includes("--apply");
const actorName = "Script: merge-xmxy-accounts";

const RENAME = [
  ["USD (XMXY)", "USD (兴业银行)"],
  ["CNY (XMXY)", "CNY (兴业银行)"],
] as const;
/** Old invoice account → the account that replaces it (null: delete only). */
const IBC: [string, string | null][] = [
  ["USD (IBC Bank)", "USD (兴业银行)"],
  ["CNY (IBC Bank)", "CNY (兴业银行)"],
  ["EUR (IBC Bank)", null],
];

async function main() {
  for (const [from, to] of RENAME) {
    const row = await prisma.bankAccount.findUnique({ where: { label: from } });
    console.log(row ? `${from} → ${to} (Invoice and balance sheet)` : `${from}: not found`);
  }
  for (const [label, into] of IBC) {
    const row = await prisma.bankAccount.findUnique({
      where: { label },
      select: { id: true, _count: { select: { invoices: true, paymentRules: true, cashTxns: true } } },
    });
    if (!row) {
      console.log(`${label}: not found`);
      continue;
    }
    const extra = await prisma.invoice.count({ where: { extraAccountIds: { has: row.id } } });
    const c = row._count;
    console.log(`${label}: ${c.invoices} invoice(s), ${extra} extra, ${c.paymentRules} rule(s), ${c.cashTxns} cash line(s) → ${into ?? "delete"}`);
  }
  if (!apply) return console.log("\nDry run. Add --apply to save.");

  await prisma.$transaction(async (tx) => {
    const xiamen = await tx.company.findUniqueOrThrow({ where: { code: "XIAMEN" } });
    const ids: Record<string, string> = {};
    for (const [from, to] of RENAME) {
      const row = await tx.bankAccount.findUnique({ where: { label: from } });
      if (!row) {
        ids[to] = (await tx.bankAccount.findUniqueOrThrow({ where: { label: to } })).id;
        continue;
      }
      const data = { label: to, use: "BOTH" as const, compact: false, companyId: xiamen.id };
      await tx.bankAccount.update({ where: { id: row.id }, data });
      await tx.activityLog.create({
        data: {
          actorName,
          action: "update",
          entity: "setting:bankAccount",
          entityId: row.id,
          label: to,
          changes: { label: { from, to }, use: { from: row.use, to: "BOTH" } },
        },
      });
      ids[to] = row.id;
    }

    for (const [label, into] of IBC) {
      const old = await tx.bankAccount.findUnique({ where: { label } });
      if (!old) continue;
      if (into) {
        const target = ids[into];
        await tx.paymentRule.updateMany({ where: { bankAccountId: old.id }, data: { bankAccountId: target } });
        await tx.invoice.updateMany({ where: { bankAccountId: old.id }, data: { bankAccountId: target } });
        for (const inv of await tx.invoice.findMany({ where: { extraAccountIds: { has: old.id } }, select: { id: true, extraAccountIds: true } })) {
          await tx.invoice.update({ where: { id: inv.id }, data: { extraAccountIds: inv.extraAccountIds.map((x) => (x === old.id ? target : x)) } });
        }
      }
      const refs =
        (await tx.invoice.count({ where: { bankAccountId: old.id } })) +
        (await tx.invoice.count({ where: { extraAccountIds: { has: old.id } } })) +
        (await tx.paymentRule.count({ where: { bankAccountId: old.id } })) +
        (await tx.cashTxn.count({ where: { accountId: old.id } }));
      if (refs) throw new Error(`${label} is still referenced (${refs}); nothing was changed.`);
      await tx.bankAccount.delete({ where: { id: old.id } });
      await tx.activityLog.create({
        data: { actorName, action: "delete", entity: "setting:bankAccount", entityId: old.id, label, changes: { mergedInto: into ?? "(unused, deleted)" } },
      });
    }

    const usdRule = await tx.paymentRule.findFirst({ where: { companyId: xiamen.id, currency: "USD" } });
    if (!usdRule) {
      const rule = await tx.paymentRule.create({ data: { companyId: xiamen.id, currency: "USD", bankAccountId: ids["USD (兴业银行)"] } });
      await tx.activityLog.create({
        data: { actorName, action: "create", entity: "setting:paymentRule", entityId: rule.id, label: "XIAMEN · USD", changes: { account: "USD (兴业银行)" } },
      });
    }
  });
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
