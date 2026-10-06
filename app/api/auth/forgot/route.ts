import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { sha256 } from "@/lib/mfa";

export const runtime = "nodejs";

const TTL_MINUTES = 30;

/** Emails a reset link. Always answers the same way, so it can't be used
 *  to find out which emails have accounts. */
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const normalized = email?.trim().toLowerCase() ?? "";
  const user = normalized
    ? await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, email: true, active: true, passwordHash: true } })
    : null;

  // Pending invitees set their password through the invitation link instead.
  if (user?.active && user.passwordHash) {
    const recent = await prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
    });
    if (recent === 0) {
      const token = randomBytes(32).toString("base64url");
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) },
      });
      const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      await sendPasswordResetEmail(user.email, `${origin}/reset/${token}`);
    }
  }
  return NextResponse.json({ ok: true });
}
