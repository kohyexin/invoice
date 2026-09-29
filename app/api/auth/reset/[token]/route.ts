import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/mfa";
import { hashPassword, passwordProblem } from "@/lib/passwords";

export const runtime = "nodejs";

async function findToken(token: string) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { email: true, active: true } } },
  });
  if (!record || record.usedAt || !record.user.active) return { status: 404 as const };
  if (record.expiresAt < new Date()) return { status: 410 as const };
  return { status: 200 as const, record };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const found = await findToken(params.token);
  if (found.status !== 200) return NextResponse.json({ error: "Invalid link." }, { status: found.status });
  return NextResponse.json({ email: found.record.user.email });
}

/** Sets the new password and signs the account out everywhere. Two-factor
 *  stays on; the next sign-in still asks for a code. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const found = await findToken(params.token);
  if (found.status !== 200) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: found.status });

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const problem = passwordProblem(password ?? "");
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: found.record.userId },
      data: { passwordHash: await hashPassword(password!), sessionVersion: { increment: 1 }, mfaFailures: 0 },
    }),
    prisma.passwordResetToken.updateMany({ where: { userId: found.record.userId, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  return NextResponse.json({ ok: true });
}
