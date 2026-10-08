import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";
import { CASH_ACCOUNTS } from "@/lib/cash-seed";

/* Fills the XMXY cash accounts' bank details (from the invoice workbook's Type sheet)
   where Settings is still blank, so Industrial Bank downloads link to them by number.

     npx tsx --conditions=react-server scripts/fill-xmxy-details.ts            show what would change
     npx tsx --conditions=react-server scripts/fill-xmxy-details.ts --apply    save it */

const apply = process.argv.includes("--apply");

async function main() {
  for (const seed of CASH_ACCOUNTS.filter((a) => a.sheet.startsWith("XMXY") && a.details)) {
    const account = await prisma.bankAccount.findUnique({ where: { label: seed.label } });
    if (!account) {
      console.log(`${seed.label}: not found, skipped`);
      continue;
    }
    const current = account as unknown as Record<string, unknown>;
    const fill: Record<string, string> = {};
    for (const [key, value] of Object.entries(seed.details!)) if (value && !current[key]) fill[key] = value;
    if (!Object.keys(fill).length) {
      console.log(`${seed.label}: already filled`);
      continue;
    }
    console.log(`${seed.label}:`, fill);
    if (!apply) continue;
    await prisma.bankAccount.update({ where: { id: account.id }, data: fill });
    await prisma.activityLog.create({
      data: {
        actorName: "Script: fill-xmxy-details",
        action: "update",
        entity: "setting:bankAccount",
        entityId: account.id,
        label: account.label,
        changes: diff(current, fill) as object,
      },
    });
  }
  if (!apply) console.log("\nDry run. Add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
