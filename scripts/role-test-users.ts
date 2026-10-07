import "dotenv/config";
import bcrypt from "bcryptjs";
import { generate, generateSecret } from "otplib";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

/* Throwaway accounts for testing roles in the browser.

     npx tsx scripts/role-test-users.ts setup     create or reset them (prints the password)
     npx tsx scripts/role-test-users.ts code <email>   current authenticator code
     npx tsx scripts/role-test-users.ts cleanup   disable them again

   Each gets a known authenticator secret so sign-in codes can be generated here. */

const PASSWORD = "RoleTest-2026-check";
const USERS = [
  { email: "roles-finance@test.local", name: "Test Finance", role: "Finance" },
  { email: "roles-staff@test.local", name: "Test Staff", role: "Staff" },
  { email: "roles-admin@test.local", name: "Test Admin", role: "Admin" },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

async function setup() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  for (const u of USERS) {
    const role = await prisma.appRole.findFirst({ where: { name: { equals: u.role, mode: "insensitive" } } });
    if (!role) {
      console.log(`Skipped ${u.email}: no role called ${u.role} yet.`);
      continue;
    }
    const data = {
      name: u.name,
      roleId: role.id,
      passwordHash,
      active: true,
      totpSecret: generateSecret(),
      totpEnabledAt: new Date(),
      totpPendingSecret: null,
      mfaFailures: 0,
      sessionVersion: { increment: 1 },
    };
    await prisma.user.upsert({ where: { email: u.email }, update: data, create: { ...data, email: u.email, sessionVersion: 0 } });
    console.log(`Ready: ${u.email} (${role.name})`);
  }
  console.log(`Password: ${PASSWORD}`);
}

async function code(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { totpSecret: true } });
  if (!user?.totpSecret) throw new Error(`No authenticator for ${email}`);
  console.log(await generate({ secret: user.totpSecret }));
}

async function cleanup() {
  const res = await prisma.user.updateMany({
    where: { email: { in: USERS.map((u) => u.email) } },
    data: { active: false, totpSecret: null, totpEnabledAt: null, sessionVersion: { increment: 1 } },
  });
  console.log(`Disabled ${res.count} test user(s).`);
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "setup" ? setup() : cmd === "code" ? code(arg) : cmd === "cleanup" ? cleanup() : Promise.reject(new Error("setup | code <email> | cleanup")))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
