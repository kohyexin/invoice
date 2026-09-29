import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Role } from "../lib/generated/prisma/client";

/* Creates a user, or resets an existing one (new password, re-enabled,
   two-factor cleared so they set up a new authenticator, signed out
   everywhere). Use it for the first admin and for lock-outs:

     npm run user:create -- --email you@example.com --name "Your Name" --role ADMIN
     npm run user:create -- --email you@example.com --password "chosen password"

   Without --password a random one is generated and printed once. */

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const role = (arg("role")?.toUpperCase() ?? undefined) as Role | undefined;
const presetHash = arg("hash");
let password = arg("password");

if (!email || (role && !["ADMIN", "STAFF", "VIEWER"].includes(role))) {
  console.error('Usage: npm run user:create -- --email <email> [--name "<name>"] [--role ADMIN|STAFF|VIEWER] [--password "<password>"]');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

async function main() {
  if (!presetHash && !password) password = randomBytes(9).toString("base64url");
  const passwordHash = presetHash ?? bcrypt.hashSync(password!, 12);

  const existing = await prisma.user.findUnique({ where: { email: email! } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        active: true,
        sessionVersion: { increment: 1 },
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        emailCodeHash: null,
        mfaFailures: 0,
        ...(name ? { name } : {}),
        ...(role ? { role } : {}),
      },
    });
    console.log(`Reset ${email} (${role ?? existing.role}).`);
  } else {
    await prisma.user.create({
      data: { email: email!, name: name ?? email!.split("@")[0], role: role ?? "ADMIN", passwordHash },
    });
    console.log(`Created ${email} (${role ?? "ADMIN"}).`);
  }
  if (password && !arg("password")) console.log(`Password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
