import "dotenv/config";
import { prisma } from "@/lib/db";

/* Delete every user except Owners (test accounts). Invoices, imports and statement lines they
   touched keep working: those links are cleared, and the activity log keeps their names.

     npx tsx --conditions=react-server scripts/cleanup-test-users.ts            show what would change
     npx tsx --conditions=react-server scripts/cleanup-test-users.ts --apply    delete them */

const apply = process.argv.includes("--apply");
const actorName = "Script: cleanup-test-users";

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
      role: { select: { name: true, system: true } },
      _count: {
        select: { invoicesCreated: true, invoicesUpdated: true, importDecisions: true, statementUploads: true, statementDecisions: true },
      },
    },
  });

  const keep = users.filter((u) => u.role.system === "OWNER");
  const remove = users.filter((u) => u.role.system !== "OWNER");
  if (keep.length === 0) throw new Error("No Owner found; refusing to delete anyone.");

  const line = async (u: (typeof users)[number]) => {
    const c = u._count;
    const logs = await prisma.activityLog.count({ where: { actorId: u.id } });
    const seen = u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : "never";
    return `  ${u.email} (${u.name || "no name"}) · ${u.role.name}${u.active ? "" : " · inactive"} · created ${u.createdAt.toISOString().slice(0, 10)} · last sign-in ${seen}
      invoices created ${c.invoicesCreated}, updated ${c.invoicesUpdated} · import decisions ${c.importDecisions} · statement uploads ${c.statementUploads}, line decisions ${c.statementDecisions} · activity entries ${logs}`;
  };

  console.log(`Keep (${keep.length}):`);
  for (const u of keep) console.log(await line(u));
  console.log(`\nDelete (${remove.length}):`);
  for (const u of remove) console.log(await line(u));

  if (!apply) return console.log("\nDry run. Add --apply to delete.");
  if (remove.length === 0) return console.log("\nNothing to delete.");

  await prisma.$transaction(async (tx) => {
    for (const u of remove) {
      await tx.user.delete({ where: { id: u.id } });
      await tx.activityLog.create({
        data: { actorName, action: "delete", entity: "user", entityId: u.id, label: u.name || u.email, changes: { email: u.email, role: u.role.name } },
      });
    }
  });
  console.log(`\nDeleted ${remove.length} user(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
