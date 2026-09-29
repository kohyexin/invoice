"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from "@/lib/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/passwords";
import { authorize } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

export async function updateMyName(name: string): Promise<Result> {
  const auth = await authorize("VIEWER");
  if (!auth.ok) return auth;
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  await prisma.user.update({ where: { id: auth.user.id }, data: { name: trimmed } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Changes the password and signs out every other device; this browser gets
 *  a fresh session so it stays signed in. */
export async function changeMyPassword(current: string, next: string): Promise<Result> {
  const auth = await authorize("VIEWER");
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
  cookies().set(SESSION_COOKIE, await createSessionToken(auth.user.id, updated.sessionVersion), sessionCookieOptions);
  return { ok: true };
}
