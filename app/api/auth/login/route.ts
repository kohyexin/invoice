import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

// Compared against when the email is unknown, so both paths take the same time.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("unknown-user", 12));

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  const normalized = email?.trim().toLowerCase() ?? "";

  const user = normalized
    ? await prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true, passwordHash: true, active: true, sessionVersion: true },
      })
    : null;
  const ok = typeof password === "string" && (await bcrypt.compare(password, user?.passwordHash ?? getDummyHash())) && Boolean(user);

  if (!ok || !user) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "This account has been disabled. Ask an admin to re-enable it." }, { status: 403 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id, user.sessionVersion), sessionCookieOptions);
  return res;
}
