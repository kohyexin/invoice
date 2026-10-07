"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { checkTotp, newTotpSetup } from "@/lib/mfa";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/passwords";
import { authorize } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

export async function updateMyName(name: string): Promise<Result> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  await prisma.user.update({ where: { id: auth.user.id }, data: { name: trimmed } });
  await logActivity(auth.user, { action: "update", entity: "user", entityId: auth.user.id, label: auth.user.email, before: { name: auth.user.name }, after: { name: trimmed } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Changes the password and signs out every other device; this browser gets
 *  a fresh session so it stays signed in. */
export async function changeMyPassword(current: string, next: string): Promise<Result> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false, error: "Current password is incorrect." };
  const problem = passwordProblem(next);
  if (problem) return { ok: false, error: problem };
  if (next === current) return { ok: false, error: "Choose a password different from the current one." };

  const updated = await prisma.user.update({
    where: { id: auth.user.id },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  cookies().set(SESSION_COOKIE, await createSessionToken(auth.user.id, updated.sessionVersion), sessionCookieOptions());
  await logActivity(auth.user, { action: "change_password", entity: "user", entityId: auth.user.id, label: auth.user.email });
  return { ok: true };
}

/** Starts moving two-factor to a new authenticator. The current one keeps
 *  working until the new one is confirmed. */
export async function startAuthenticatorChange(
  password: string
): Promise<{ ok: true; secret: string; qr: string } | { ok: false; error: string }> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { passwordHash: true, email: true } });
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: "Current password is incorrect." };
  const setup = await newTotpSetup(user.email);
  await prisma.user.update({ where: { id: auth.user.id }, data: { totpPendingSecret: setup.secret } });
  return { ok: true, ...setup };
}

/** Confirms the new authenticator with a live code. Browsers remembered for
 *  48 hours are forgotten and other devices are signed out. */
export async function confirmAuthenticatorChange(code: string): Promise<Result> {
  const auth = await authorize();
  if (!auth.ok) return auth;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.user.id }, select: { totpPendingSecret: true } });
  if (!user.totpPendingSecret) return { ok: false, error: "Start the setup again." };
  if (!(await checkTotp(user.totpPendingSecret, code.trim()))) return { ok: false, error: "Invalid code. Please try again." };

  const updated = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      totpSecret: user.totpPendingSecret,
      totpPendingSecret: null,
      totpEnabledAt: new Date(),
      sessionVersion: { increment: 1 },
    },
    select: { sessionVersion: true },
  });
  cookies().set(SESSION_COOKIE, await createSessionToken(auth.user.id, updated.sessionVersion), sessionCookieOptions());
  await logActivity(auth.user, { action: "change_authenticator", entity: "user", entityId: auth.user.id, label: auth.user.email });
  revalidatePath("/account");
  return { ok: true };
}
