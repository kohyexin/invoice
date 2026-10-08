import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { AIRWALLEX_PAY, CASH_ACCOUNTS } from "@/lib/cash-seed";
import type { AccountUse, Prisma } from "@/lib/generated/prisma/client";

/* Split Airwallex Pay (ledger) from Airwallex Pay (compact invoice extra), merge SCB invoice
   accounts into (Airwallex) GA accounts, delete SCB duplicates.

     npx tsx --conditions=react-server scripts/merge-airwallex-accounts.ts
     npx tsx --conditions=react-server scripts/merge-airwallex-accounts.ts --apply */

const apply = process.argv.includes("--apply");
const ACTOR = "Script: merge-airwallex-accounts";

const SCB = ["USD (SCB Bank)", "HKD (SCB Bank)", "EUR (SCB Bank)"] as const;
const AW = ["USD (Airwallex)", "HKD (Airwallex)", "EUR (Airwallex)", "SGD (Airwallex)", "CNY (Airwallex)"] as const;

const gaSeed = (label: string) => CASH_ACCOUNTS.find((a) => a.label === label)!;

function gaUpdate(label: string): Prisma.BankAccountUpdateInput {
  const seed = gaSeed(label);
  const d = seed.details!;
  return {
    use: "BOTH" as AccountUse,
    compact: false,
    company: { connect: { code: "STAR" } },
    accountName: seed.accountName,
    accountNumber: d.accountNumber ?? "",
    bankName: d.bankName ?? seed.bankName,
    accountType: d.accountType ?? "",
    bankAddress: d.bankAddress ?? "",
    bankCode: d.bankCode ?? "",
    branchCode: d.branchCode ?? "",
    swiftCode: d.swiftCode ?? "",
    accountLocation: d.accountLocation ?? "",
  };
}

async function log(entityId: string, label: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  if (!apply) return;
  const changes = diff(before, after);
  if (!Object.keys(changes).length) return;
  await prisma.activityLog.create({
    data: { actorName: ACTOR, action: "update", entity: "setting:bankAccount", entityId, label, changes: changes as object },
  });
}

async function main() {
  const ledger = await prisma.bankAccount.findUnique({ where: { label: "Airwallex Pay" } });
  if (!ledger) throw new Error('No "Airwallex Pay" account — already merged?');
  if (await prisma.bankAccount.findUnique({ where: { label: "USD (Airwallex)" } })) {
    throw new Error('USD (Airwallex) already exists — merge may have run already.');
  }

  const ledgerId = ledger.id;
  const extraIds = (
    await prisma.invoice.findMany({ where: { extraAccountIds: { has: ledgerId } }, select: { id: true, extraAccountIds: true } })
  ).map((i) => i.id);

  console.log(`Ledger row "${ledger.label}" (${ledgerId}) → USD (Airwallex); ${extraIds.length} invoice(s) use it as Also show`);
  console.log("Will create new compact Airwallex Pay for invoices.");
  for (const scb of SCB) {
    const row = await prisma.bankAccount.findUnique({ where: { label: scb }, include: { paymentRules: true, _count: { select: { invoices: true } } } });
    if (row) console.log(`  ${scb}: ${row._count.invoices} invoice(s), ${row.paymentRules.length} rule(s) → ${scb.replace("SCB Bank", "Airwallex")}`);
  }

  if (!apply) {
    console.log("\nDry run. Add --apply to save.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const beforeLedger = { ...ledger };
    await tx.bankAccount.update({
      where: { id: ledgerId },
      data: { label: "USD (Airwallex)", ...gaUpdate("USD (Airwallex)") },
    });
    await log(ledgerId, "USD (Airwallex)", beforeLedger as unknown as Record<string, unknown>, { label: "USD (Airwallex)", use: "BOTH", compact: false });

    const maxSort = (await tx.bankAccount.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const pay = await tx.bankAccount.create({
      data: {
        label: AIRWALLEX_PAY.label,
        currency: AIRWALLEX_PAY.currency,
        accountName: AIRWALLEX_PAY.accountName,
        accountNumber: AIRWALLEX_PAY.accountNumber,
        bankName: "",
        use: "INVOICE",
        compact: true,
        offStatement: 0,
        sortOrder: maxSort + 1,
        company: { connect: { code: "STAR" } },
      },
    });
    await tx.activityLog.create({
      data: {
        actorName: ACTOR,
        action: "create",
        entity: "setting:bankAccount",
        entityId: pay.id,
        label: pay.label,
        changes: { compact: true, use: "INVOICE" },
      },
    });

    for (const id of extraIds) {
      const inv = await tx.invoice.findUnique({ where: { id }, select: { extraAccountIds: true } });
      if (!inv) continue;
      await tx.invoice.update({
        where: { id },
        data: { extraAccountIds: inv.extraAccountIds.map((x) => (x === ledgerId ? pay.id : x)) },
      });
    }

    for (const label of AW) {
      if (label === "USD (Airwallex)") continue;
      const row = await tx.bankAccount.findUnique({ where: { label } });
      if (!row) {
        console.log(`${label}: not found, skipped`);
        continue;
      }
      const before = { ...row };
      await tx.bankAccount.update({ where: { id: row.id }, data: gaUpdate(label) });
      await log(row.id, label, before as unknown as Record<string, unknown>, gaUpdate(label) as Record<string, unknown>);
    }

    for (const scbLabel of SCB) {
      const scb = await tx.bankAccount.findUnique({ where: { label: scbLabel } });
      if (!scb) continue;
      const awLabel = scbLabel.replace("SCB Bank", "Airwallex");
      const aw = await tx.bankAccount.findUnique({ where: { label: awLabel } });
      if (!aw) throw new Error(`Missing ${awLabel}`);

      await tx.paymentRule.updateMany({ where: { bankAccountId: scb.id }, data: { bankAccountId: aw.id } });
      await tx.invoice.updateMany({ where: { bankAccountId: scb.id }, data: { bankAccountId: aw.id } });

      const refs =
        (await tx.invoice.count({ where: { bankAccountId: scb.id } })) +
        (await tx.paymentRule.count({ where: { bankAccountId: scb.id } })) +
        (await tx.cashTxn.count({ where: { accountId: scb.id } }));
      if (refs) throw new Error(`${scbLabel} still referenced (${refs})`);

      await tx.bankAccount.delete({ where: { id: scb.id } });
      await tx.activityLog.create({
        data: { actorName: ACTOR, action: "delete", entity: "setting:bankAccount", entityId: scb.id, label: scbLabel, changes: { mergedInto: awLabel } },
      });
    }
  });

  console.log("Done. Run setup-airwallex.ts --apply if any GA field still differs from docx.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
