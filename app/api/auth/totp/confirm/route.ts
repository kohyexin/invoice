import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkTotp, completeSignIn, getPendingUser, recordFailure } from "@/lib/mfa";

export const runtime = "nodejs";

/** Finishes first-time enrolment and signs in. */
export async function POST(req: Request) {
  const user = await getPendingUser();
  if (!user) return NextResponse.json({ error: "Too many attempts. Sign in again.", restart: true }, { status: 401 });
  if (user.totpSecret || !user.totpPendingSecret) {
    return NextResponse.json({ error: "Start the setup again." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { code?: string; rememberDevice?: boolean } | null;
  if (!(await checkTotp(user.totpPendingSecret, body?.code?.trim() ?? ""))) {
    const locked = await recordFailure(user.id);
    return NextResponse.json(
      locked ? { error: "Too many attempts. Sign in again.", restart: true } : { error: "Invalid code. Please try again." },
      { status: 401 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date() },
  });
  await completeSignIn(user.id, user.sessionVersion, user.remember, body?.rememberDevice === true);
  return NextResponse.json({ ok: true });
}
