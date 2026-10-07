import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/mfa";
import { hashPassword, passwordProblem } from "@/lib/passwords";

export const runtime = "nodejs";

async function findInvite(token: string) {
  const user = await prisma.user.findUnique({
    where: { inviteTokenHash: sha256(token) },
    select: { id: true, email: true, name: true, role: { select: { name: true, system: true } }, active: true, passwordHash: true, inviteExpiresAt: true },
  });
  if (!user || !user.active || user.passwordHash) return { status: 404 as const };
  if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) return { status: 410 as const };
  return { status: 200 as const, user };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const found = await findInvite(params.token);
  if (found.status !== 200) return NextResponse.json({ error: "Invalid link." }, { status: found.status });
  const { email, name, role } = found.user;
  return NextResponse.json({ email, name, role: role.name, roleSystem: role.system });
}

/** Accepts the invitation: sets the name and password and retires the link.
 *  Two-factor is enrolled at the first sign-in, like every other account. */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const found = await findInvite(params.token);
  if (found.status !== 200) return NextResponse.json({ error: "This invitation is invalid or has expired." }, { status: found.status });

  const { name, password } = (await req.json().catch(() => ({}))) as { name?: string; password?: string };
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (trimmed.length > 100) return NextResponse.json({ error: "Name is too long." }, { status: 400 });
  const problem = passwordProblem(password ?? "");
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const accepted = await prisma.user.updateMany({
    where: { id: found.user.id, passwordHash: "" },
    data: {
      name: trimmed,
      passwordHash: await hashPassword(password!),
      inviteTokenHash: null,
      inviteExpiresAt: null,
      sessionVersion: { increment: 1 },
      mfaFailures: 0,
    },
  });
  if (accepted.count === 0) return NextResponse.json({ error: "This invitation is invalid or has expired." }, { status: 404 });
  await logActivity(
    { id: found.user.id, name: trimmed, email: found.user.email },
    { action: "accept_invite", entity: "user", entityId: found.user.id, label: found.user.email }
  );
  return NextResponse.json({ ok: true, email: found.user.email });
}
