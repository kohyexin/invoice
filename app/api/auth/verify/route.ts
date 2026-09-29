import { NextResponse } from "next/server";
import { checkTotp, completeSignIn, emailCodeValid, getPendingUser, recordFailure } from "@/lib/mfa";

export const runtime = "nodejs";

const INVALID = { error: "Invalid code. Please try again." };
const EXPIRED = { error: "Too many attempts. Sign in again.", restart: true };

/** Step two: a code from the authenticator app or the emailed code. */
export async function POST(req: Request) {
  const user = await getPendingUser();
  if (!user) return NextResponse.json(EXPIRED, { status: 401 });

  const body = (await req.json().catch(() => null)) as { code?: string; channel?: string; rememberDevice?: boolean } | null;
  const code = body?.code?.trim() ?? "";

  const valid =
    body?.channel === "email"
      ? emailCodeValid(user, code)
      : Boolean(user.totpSecret) && (await checkTotp(user.totpSecret!, code));

  if (!valid) {
    const locked = await recordFailure(user.id);
    return NextResponse.json(locked ? EXPIRED : INVALID, { status: 401 });
  }

  // An emailed code doesn't prove the authenticator, so it can't enrol one.
  if (!user.totpSecret) return NextResponse.json(INVALID, { status: 401 });

  await completeSignIn(user.id, user.sessionVersion, user.remember, body?.rememberDevice === true);
  return NextResponse.json({ ok: true });
}
