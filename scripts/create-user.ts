import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

/* Creates a user, or resets an existing one (new password, re-enabled,
   two-factor cleared so they set up a new authenticator, signed out
   everywhere). Use it for the first owner and for lock-outs:

     npm run user:create -- --email you@example.com --name "Your Name" --role Owner
     npm run user:create -- --email you@example.com --password "chosen password"

   --role takes a role name as shown under Settings → Roles (any case).
   New users default to Owner. Without --password a random one is
   generated and printed once. */

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const roleName = arg("role")?.trim();
const presetHash = arg("hash");
let password = arg("password");

if (!email) {
  console.error('Usage: npm run user:create -- --email <email> [--name "<name>"] [--role "<role name>"] [--password "<password>"]');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }),
});

async function main() {
  const role = roleName
    ? await prisma.appRole.findFirst({ where: { name: { equals: roleName, mode: "insensitive" } } })
    : null;
  if (roleName && !role) {
    const names = (await prisma.appRole.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } })).map((r) => r.name);
    throw new Error(`No role called "${roleName}". Roles: ${names.join(", ")}`);
  }

  if (!presetHash && !password) password = randomBytes(9).toString("base64url");
  const passwordHash = presetHash ?? bcrypt.hashSync(password!, 12);

  const existing = await prisma.user.findUnique({ where: { email: email! }, include: { role: true } });
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
        ...(role ? { roleId: role.id } : {}),
      },
    });
    console.log(`Reset ${email} (${role?.name ?? existing.role.name}).`);
  } else {
    const owner = role ?? (await prisma.appRole.findUniqueOrThrow({ where: { system: "OWNER" } }));
    await prisma.user.create({
      data: { email: email!, name: name ?? email!.split("@")[0], roleId: owner.id, passwordHash },
    });
    console.log(`Created ${email} (${owner.name}).`);
  }
  if (password && !arg("password")) console.log(`Password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
