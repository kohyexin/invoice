import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { AIRWALLEX_PAY, CASH_ACCOUNTS } from "@/lib/cash-seed";

/* Sync Airwallex account details from cash-seed (docx). Also sets Yield on USD (Airwallex).

     npx tsx --conditions=react-server scripts/setup-airwallex.ts
     npx tsx --conditions=react-server scripts/setup-airwallex.ts --apply */

const apply = process.argv.includes("--apply");
const YIELD = 400_000;
const ACTOR = "Script: setup-airwallex";

const GA_LABELS = CASH_ACCOUNTS.filter((a) => a.sheet.startsWith("A - ") && a.details).map((a) => a.label);

async function save(account: { id: string; label: string }, before: Record<string, unknown>, data: Record<string, unknown>) {
  const changes = diff(before, data);
  if (!Object.keys(changes).length) {
    console.log(`${account.label}: already matches`);
    return;
  }
  console.log(`${account.label}:`, data);
  if (!apply) return;
  await prisma.bankAccount.update({ where: { id: account.id }, data });
  await prisma.activityLog.create({
    data: { actorName: ACTOR, action: "update", entity: "setting:bankAccount", entityId: account.id, label: account.label, changes: changes as object },
  });
}

function gaData(seed: (typeof CASH_ACCOUNTS)[number]) {
  const d = seed.details!;
  return {
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

async function main() {
  const usd = await prisma.bankAccount.findUnique({ where: { label: "USD (Airwallex)" } });
  if (!usd) console.log("USD (Airwallex): not found (run merge-airwallex-accounts first?)");
  else if (Number(usd.offStatement) === YIELD) console.log("USD (Airwallex): Yield amount already set");
  else await save(usd, { offStatement: Number(usd.offStatement) }, { offStatement: YIELD });

  for (const label of GA_LABELS) {
    const seed = CASH_ACCOUNTS.find((a) => a.label === label)!;
    const account = await prisma.bankAccount.findUnique({ where: { label } });
    if (!account) {
      console.log(`${label}: not found, skipped`);
      continue;
    }
    await save(account, account as unknown as Record<string, unknown>, gaData(seed));
  }

  const pay = await prisma.bankAccount.findUnique({ where: { label: AIRWALLEX_PAY.label } });
  if (!pay) console.log(`${AIRWALLEX_PAY.label}: not found, skipped`);
  else
    await save(pay, pay as unknown as Record<string, unknown>, {
      accountName: AIRWALLEX_PAY.accountName,
      accountNumber: AIRWALLEX_PAY.accountNumber,
      compact: true,
      use: "INVOICE",
      offStatement: 0,
    });

  if (!apply) console.log("\nDry run. Add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
