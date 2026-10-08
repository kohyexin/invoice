import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { CASH_ACCOUNTS } from "@/lib/cash-seed";

/* One-off setup for Airwallex statement imports:
   - Airwallex Pay: 400,000.00 held in Airwallex Yield, which the Balance Activity Report
     doesn't show, so the import compares the wallet part of the book only;
   - Airwallex Pay, HKD and EUR (Airwallex): Global Account details where Settings is still
     blank. Airwallex Pay's old seed number is replaced: it was never on an invoice or statement.

     npx tsx --conditions=react-server scripts/setup-airwallex.ts            show what would change
     npx tsx --conditions=react-server scripts/setup-airwallex.ts --apply    save it */

const apply = process.argv.includes("--apply");
const YIELD = 400_000;
const OLD_PAY_NUMBER = "1011107325955705";

async function save(account: { id: string; label: string }, before: Record<string, unknown>, data: Record<string, unknown>) {
  console.log(`${account.label}:`, data);
  if (!apply) return;
  await prisma.bankAccount.update({ where: { id: account.id }, data });
  await prisma.activityLog.create({
    data: {
      actorName: "Script: setup-airwallex",
      action: "update",
      entity: "setting:bankAccount",
      entityId: account.id,
      label: account.label,
      changes: diff(before, data) as object,
    },
  });
}

async function main() {
  const pay = await prisma.bankAccount.findUnique({ where: { label: "Airwallex Pay" } });
  if (!pay) console.log("Airwallex Pay: not found, skipped");
  else if (Number(pay.offStatement) === YIELD) console.log("Airwallex Pay: Yield amount already set");
  else await save(pay, { offStatement: Number(pay.offStatement) }, { offStatement: YIELD });

  for (const seed of CASH_ACCOUNTS.filter((a) => a.sheet.startsWith("A - ") && a.details)) {
    const account = await prisma.bankAccount.findUnique({ where: { label: seed.label } });
    if (!account) {
      console.log(`${seed.label}: not found, skipped`);
      continue;
    }
    const current = account as unknown as Record<string, unknown>;
    const fill: Record<string, string> = {};
    for (const [key, value] of Object.entries(seed.details!)) {
      const stale = key === "accountNumber" && current[key] === OLD_PAY_NUMBER;
      if (value && (!current[key] || stale)) fill[key] = value;
    }
    if (!Object.keys(fill).length) console.log(`${seed.label}: already filled`);
    else await save(account, current, fill);
  }
  if (!apply) console.log("\nDry run. Add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
