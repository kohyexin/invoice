import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { can, effectivePermissions, FEATURES, isManager, isOwner, levelName, normalizePermissions, type Feature, type Level } from "../lib/roles";
import { canSee, navGroups } from "../lib/nav";

/* Prints what every role in the database can do, and checks the fixed rules
   that must never change. Exits non-zero when a rule is broken.

     npx tsx scripts/check-permissions.ts */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

let failures = 0;
function expect(ok: boolean, what: string) {
  if (!ok) {
    failures++;
    console.error(`FAIL  ${what}`);
  }
}

function rules() {
  const owner = { system: "OWNER" as const, permissions: effectivePermissions("OWNER", {}) };
  const admin = { system: "ADMIN" as const, permissions: effectivePermissions("ADMIN", { cashBook: "EDIT" }) };
  for (const f of FEATURES) expect(can(owner, f.key, f.levels[f.levels.length - 1]), `Owner has the top level of ${f.key}`);
  for (const f of FEATURES) {
    const top = f.levels[f.levels.length - 1] as Level;
    if (f.key === "invoicePayments") continue;
    const capped = f.key === "cashBook" || f.key === "statementImport";
    expect(can(admin, f.key, capped ? "VIEW" : top) && (!capped || !can(admin, f.key, "EDIT")), `Admin: ${f.key} is ${capped ? "VIEW only" : top}`);
  }
  expect(!can(admin, "invoicePayments", "EDIT"), "Admin can't mark invoices paid or change their status");
  expect(normalizePermissions({ invoices: "EDIT" }).invoicePayments === "EDIT", "older roles with Invoices: Edit keep payments");
  expect(normalizePermissions({ invoices: "EDIT", invoicePayments: "NONE" }).invoicePayments === "NONE", "payments can be turned off separately");
  expect(isOwner(owner) && isManager(owner) && isManager(admin) && !isOwner(admin), "Owner and Admin are managers; only Owner is owner");

  const junk = normalizePermissions({ dashboard: "NONE", invoiceCreate: "VIEW", cashReports: "EDIT", bogus: "EDIT", clients: 5 });
  expect(junk.dashboard === "VIEW", "dashboard can't go below Basic");
  expect(junk.invoiceCreate === "NONE", "invoiceCreate has no VIEW level");
  expect(junk.cashReports === "NONE", "cashReports has no EDIT level");
  expect(junk.clients === "NONE" && !("bogus" in junk), "unknown values and features are dropped");

  const custom = { system: null, permissions: effectivePermissions(null, { invoices: "VIEW" }) };
  expect(!isManager(custom), "custom roles never manage users and roles");
  const settings = navGroups.flatMap((g) => g.items).find((i) => i.href === "/settings")!;
  expect(canSee(settings, { ...admin, id: "", name: "" }) && !canSee(settings, { ...custom, id: "", name: "" }), "Settings link: managers yes, no-settings role no");
  const dash = navGroups.flatMap((g) => g.items).find((i) => i.href === "/dashboard")!;
  expect(canSee(dash, { ...custom, id: "", name: "" }), "everyone sees Dashboard");
}

async function matrix() {
  const roles = await prisma.appRole.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { users: true } } } });
  const width = Math.max(12, ...roles.map((r) => r.name.length + 6));
  console.log(["Feature".padEnd(18), ...roles.map((r) => `${r.name} (${r._count.users})`.padEnd(width))].join(""));
  for (const f of FEATURES) {
    const cells = roles.map((r) => levelName(f.key as Feature, effectivePermissions(r.system, r.permissions)[f.key]).padEnd(width));
    console.log([f.key.padEnd(18), ...cells].join(""));
  }
  console.log(["Users & roles".padEnd(18), ...roles.map((r) => (r.system ? (r.system === "OWNER" ? "All" : "Not Owners") : "None").padEnd(width))].join(""));

  expect(roles.filter((r) => r.system === "OWNER").length === 1, "exactly one Owner role");
  expect(roles.filter((r) => r.system === "ADMIN").length === 1, "exactly one Admin role");
  const owners = await prisma.user.count({ where: { role: { system: "OWNER" }, active: true, NOT: { passwordHash: "" } } });
  expect(owners >= 1, "at least one active Owner");
  console.log(`\nActive Owners: ${owners}`);
}

rules();
matrix()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
    if (failures) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
