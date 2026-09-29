import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPendingUser, newTotpSetup } from "@/lib/mfa";

export const runtime = "nodejs";

/** First sign-in: start authenticator enrolment. The secret stays pending
 *  until /totp/confirm checks a live code against it. */
export async function POST() {
  const user = await getPendingUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (user.totpSecret) return NextResponse.json({ error: "Two-factor authentication is already set up." }, { status: 409 });

  const setup = await newTotpSetup(user.email);
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: setup.secret } });
  return NextResponse.json(setup);
}
