import "dotenv/config";
import { prisma } from "@/lib/db";
import { diff } from "@/lib/activity";

/* One-off XMXY corrections:
     - 10 Sep 2026 salary (代发工资) and severance (一次性补偿金), approved from the statement
       before the import knew about 使用月 → 使用月 August 2026, and their counterparties
       remembered as booked one month back
     - USD (XMXY) funding and interest lines typed as 2025 in the workbook → 2024

     npx tsx --conditions=react-server scripts/fix-xmxy-months.ts            show what would change
     npx tsx --conditions=react-server scripts/fix-xmxy-months.ts --apply    save it */

const apply = process.argv.includes("--apply");
const actorName = "Script: fix-xmxy-months";
const day = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function log(entityId: string, label: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  await prisma.activityLog.create({ data: { actorName, action: "update", entity: "cash_entry", entityId, label, changes: diff(before, after) as object } });
}

async function main() {
  const cny = await prisma.bankAccount.findUniqueOrThrow({ where: { label: "CNY (兴业银行)" } });
  const usd = await prisma.bankAccount.findUniqueOrThrow({ where: { label: "USD (兴业银行)" } });

  const august = utc("2026-08-01");
  const sept = await prisma.cashTxn.findMany({
    where: { accountId: cny.id, date: utc("2026-09-10"), importKey: { not: null }, amountOut: { in: [250728.4, 39900] } },
  });
  if (sept.length !== 2) console.log(`10 Sep lines: expected 2, found ${sept.length}`);
  for (const t of sept) {
    const label = `${day(t.date)} · ${t.purpose}`;
    if (t.period.getTime() === august.getTime()) {
      console.log(`${label}: already August`);
      continue;
    }
    const line = await prisma.statementLine.findUnique({ where: { key: t.importKey! } });
    console.log(`${label} -${t.amountOut}: 使用月 ${t.period.toISOString().slice(0, 7)} → 2026-08; counterparty "${line?.counterparty ?? ""}" one month back`);
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      await tx.cashTxn.update({ where: { id: t.id }, data: { period: august } });
      await tx.statementLine.updateMany({ where: { key: t.importKey! }, data: { period: august } });
      if (line?.counterparty) {
        await tx.cashHint.updateMany({ where: { accountId: cny.id, counterparty: line.counterparty, direction: "out" }, data: { periodLag: 1 } });
      }
    });
    await log(t.id, label, t, { period: august });
  }

  const usdFixes = ["2025-07-10", "2025-07-16", "2025-09-21"];
  const usdLines = await prisma.cashTxn.findMany({ where: { accountId: usd.id, date: { in: usdFixes.map(utc) } }, orderBy: [{ date: "asc" }, { seq: "asc" }] });
  if (usdLines.length !== usdFixes.length) console.log(`USD lines: expected ${usdFixes.length}, found ${usdLines.length}`);
  for (const t of usdLines) {
    const date = new Date(Date.UTC(t.date.getUTCFullYear() - 1, t.date.getUTCMonth(), t.date.getUTCDate()));
    const label = `${day(t.date)} · ${t.purpose}`;
    console.log(`USD ${label} +${t.amountIn}: 记账日期 → ${day(date)} (使用月 stays ${t.period.toISOString().slice(0, 7)})`);
    if (!apply) continue;
    await prisma.cashTxn.update({ where: { id: t.id }, data: { date } });
    await log(t.id, label, t, { date });
  }

  if (!apply) console.log("\nDry run. Add --apply to save.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
