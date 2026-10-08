import "dotenv/config";
import { prisma } from "@/lib/db";

/* Issuer picker on New invoice: STAR, XIAMEN, SPARK, with STAR (first) as the default.

     npx tsx --conditions=react-server scripts/reorder-issuers.ts            show what would change
     npx tsx --conditions=react-server scripts/reorder-issuers.ts --apply    save it */

const apply = process.argv.includes("--apply");
const actorName = "Script: reorder-issuers";
const ORDER = ["STAR", "XIAMEN", "SPARK"];

async function main() {
  const rows = await prisma.company.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  const rest = rows.filter((c) => !ORDER.includes(c.code));
  const wanted = [...ORDER.map((code) => rows.find((c) => c.code === code)).filter((c) => c !== undefined), ...rest];
  const changes = wanted.map((c, i) => ({ c, to: i })).filter(({ c, to }) => c.sortOrder !== to);

  for (const { c, to } of changes) console.log(`${c.code}: sort order ${c.sortOrder} → ${to}`);
  if (changes.length === 0) return console.log("Already in order.");
  if (!apply) return console.log("\nDry run. Add --apply to save.");

  await prisma.$transaction(async (tx) => {
    for (const { c, to } of changes) {
      await tx.company.update({ where: { id: c.id }, data: { sortOrder: to } });
      await tx.activityLog.create({
        data: { actorName, action: "update", entity: "setting:company", entityId: c.id, label: c.code, changes: { sortOrder: [c.sortOrder, to] } },
      });
    }
  });
  console.log("\nSaved.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
