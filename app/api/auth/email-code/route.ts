import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendSignInCodeEmail } from "@/lib/email";
import { EMAIL_CODE_COOLDOWN_SECONDS, getPendingUser, newEmailCode } from "@/lib/mfa";

export const runtime = "nodejs";

/** "Sign in another way": email a one-time code to the account address. */
export async function POST() {
  const user = await getPendingUser();
  if (!user) return NextResponse.json({ error: "Sign in again.", restart: true }, { status: 401 });
  if (!user.totpSecret) return NextResponse.json({ error: "Set up your authenticator app first." }, { status: 409 });

  if (user.emailCodeSentAt && Date.now() - user.emailCodeSentAt.getTime() < EMAIL_CODE_COOLDOWN_SECONDS * 1000) {
    return NextResponse.json({ error: "Please wait before requesting another code." }, { status: 429 });
  }

  const { code, hash } = newEmailCode();
  await prisma.user.update({ where: { id: user.id }, data: { emailCodeHash: hash, emailCodeSentAt: new Date() } });
  const result = await sendSignInCodeEmail(user.email, user.name, code);
  if (!result.sent) return NextResponse.json({ error: "Couldn't send the email. Please try again." }, { status: 502 });
  return NextResponse.json({ ok: true, mocked: result.mocked });
}
