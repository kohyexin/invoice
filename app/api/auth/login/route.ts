import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { completeSignIn, isTrustedBrowser, startMfa } from "@/lib/mfa";

export const runtime = "nodejs";

// Compared against when the email is unknown, so both paths take the same time.
let dummyHash: string | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("unknown-user", 12));

/** Step one: email + password. A browser trusted within 48 hours signs
 *  straight in; otherwise the second factor is next (/verify). */
export async function POST(req: Request) {
  const { email, password, remember } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    remember?: boolean;
  };
  const normalized = email?.trim().toLowerCase() ?? "";

  const user = normalized
    ? await prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true, passwordHash: true, active: true, sessionVersion: true, totpSecret: true },
      })
    : null;
  const ok = typeof password === "string" && (await bcrypt.compare(password, user?.passwordHash ?? getDummyHash())) && Boolean(user);

  if (!ok || !user) {
    return NextResponse.json({ error: "Invalid email address or password." }, { status: 401 });
  }
  if (!user.active) {
    return NextResponse.json({ error: "This account has been disabled. Ask an admin to re-enable it." }, { status: 403 });
  }

  const keep = remember === true;
  if (user.totpSecret && (await isTrustedBrowser(user.id, user.sessionVersion))) {
    await completeSignIn(user.id, user.sessionVersion, keep, false);
    return NextResponse.json({ trusted: true });
  }
  await startMfa(user.id, user.sessionVersion, keep);
  return NextResponse.json({ trusted: false });
}
