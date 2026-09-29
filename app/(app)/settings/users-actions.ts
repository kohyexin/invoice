"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/client";
import { generatePassword, hashPassword, passwordProblem } from "@/lib/passwords";
import { authorize } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const ROLES: Role[] = ["ADMIN", "STAFF", "VIEWER"];

/** Creates or edits a user. A new user with a blank password, or an existing
 *  one with `resetPassword` ticked, gets a generated password, returned once
 *  so the admin can pass it on. */
export async function saveUser(id: string | null, input: Record<string, unknown>): Promise<Result<{ password?: string }>> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const role = String(input.role ?? "") as Role;
  const active = Boolean(input.active);
  const typed = String(input.password ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!ROLES.includes(role)) return { ok: false, error: "Pick a role." };
  if (typed) {
    const problem = passwordProblem(typed);
    if (problem) return { ok: false, error: problem };
  }

  const self = id === auth.user.id;
  if (self && role !== "ADMIN") return { ok: false, error: "You can't remove your own admin role. Ask another admin." };
  if (self && !active) return { ok: false, error: "You can't disable your own account." };

  try {
    if (!id) {
      const password = typed || generatePassword();
      await prisma.user.create({ data: { email, name, role, active, passwordHash: await hashPassword(password) } });
      revalidatePath("/settings");
      return { ok: true, password };
    }

    const before = await prisma.user.findUnique({ where: { id }, select: { role: true, active: true } });
    if (!before) return { ok: false, error: "That user no longer exists." };
    if (before.role === "ADMIN" && before.active && (role !== "ADMIN" || !active)) {
      const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) return { ok: false, error: "This is the only active admin. Make someone else an admin first." };
    }

    const password = input.resetPassword ? generatePassword() : undefined;
    await prisma.user.update({
      where: { id },
      data: {
        email,
        name,
        role,
        active,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
        // Signs the user out on every device.
        ...(password || (before.active && !active) ? { sessionVersion: { increment: 1 } } : {}),
      },
    });
    revalidatePath("/settings");
    return { ok: true, password };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another user already has that email." : msg };
  }
}