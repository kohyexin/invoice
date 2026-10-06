"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import type { Role } from "@/lib/generated/prisma/client";
import { sha256 } from "@/lib/mfa";
import { generatePassword, hashPassword } from "@/lib/passwords";
import { ROLE_LABEL } from "@/lib/roles";
import { authorize } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const ROLES: Role[] = ["ADMIN", "STAFF", "VIEWER"];
const INVITE_TTL_HOURS = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function origin() {
  const fixed = process.env.APP_URL?.replace(/\/$/, "");
  if (fixed) return fixed;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** A fresh one-time token: the raw value goes in the link, only its hash is stored. */
function newInvite() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    data: { inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000), invitedAt: new Date() },
  };
}

async function deliver(email: string, token: string, inviterName: string, role: Role) {
  const link = `${origin()}/invite/${token}`;
  const result = await sendInviteEmail(email, link, inviterName, ROLE_LABEL[role]);
  const emailed: Delivery = result.mocked ? "logged" : result.sent ? "sent" : "failed";
  return { link, emailed };
}

type Delivery = "sent" | "logged" | "failed";

/** Invites someone by email. They have no password until they accept the
 *  link, so they can't sign in before then. The link is also returned so the
 *  admin can pass it on if the email doesn't arrive. */
export async function inviteUser(input: Record<string, unknown>): Promise<Result<{ link: string; emailed: Delivery }>> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const role = String(input.role ?? "") as Role;
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!ROLES.includes(role)) return { ok: false, error: "Pick a role." };

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "Another user already has that email." };

  const { token, data } = newInvite();
  try {
    await prisma.user.create({ data: { email, name, role, active: true, passwordHash: "", invitedById: auth.user.id, ...data } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another user already has that email." : msg };
  }
  const sent = await deliver(email, token, auth.user.name || auth.user.email, role);
  revalidatePath("/settings");
  return { ok: true, ...sent };
}

/** Sends a new invitation link; the previous one stops working. */
export async function resendInvite(id: string): Promise<Result<{ link: string; emailed: Delivery }>> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;

  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true, passwordHash: true } });
  if (!user) return { ok: false, error: "That user no longer exists." };
  if (user.passwordHash) return { ok: false, error: "This user has already accepted their invitation." };

  const { token, data } = newInvite();
  await prisma.user.update({ where: { id }, data: { ...data, invitedById: auth.user.id } });
  const sent = await deliver(user.email, token, auth.user.name || auth.user.email, user.role);
  revalidatePath("/settings");
  return { ok: true, ...sent };
}

/** Edits an existing user. With `resetPassword` ticked they get a generated
 *  password, returned once so the admin can pass it on. */
export async function saveUser(id: string, input: Record<string, unknown>): Promise<Result<{ password?: string }>> {
  const auth = await authorize("ADMIN");
  if (!auth.ok) return auth;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const role = String(input.role ?? "") as Role;
  const active = Boolean(input.active);

  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!ROLES.includes(role)) return { ok: false, error: "Pick a role." };

  const self = id === auth.user.id;
  if (self && role !== "ADMIN") return { ok: false, error: "You can't remove your own admin role. Ask another admin." };
  if (self && !active) return { ok: false, error: "You can't disable your own account." };

  try {
    const before = await prisma.user.findUnique({ where: { id }, select: { role: true, active: true, name: true, passwordHash: true } });
    if (!before) return { ok: false, error: "That user no longer exists." };
    const pending = !before.passwordHash;
    if (!name && !pending) return { ok: false, error: "Name is required." };
    if (before.role === "ADMIN" && before.active && (role !== "ADMIN" || !active)) {
      const admins = await prisma.user.count({ where: { role: "ADMIN", active: true, NOT: { passwordHash: "" } } });
      if (admins <= 1) return { ok: false, error: "This is the only active admin. Make someone else an admin first." };
    }

    // A pending invitee sets their own password when they accept.
    const password = input.resetPassword && !pending ? generatePassword() : undefined;
    const resetTwoFactor = Boolean(input.resetTwoFactor) && !pending;
    await prisma.user.update({
      where: { id },
      data: {
        email,
        name,
        role,
        active,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
        // They enrol a new authenticator on their next sign-in.
        ...(resetTwoFactor ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, emailCodeHash: null } : {}),
        // Signs the user out on every device and forgets remembered browsers.
        ...(password || resetTwoFactor || (before.active && !active) ? { sessionVersion: { increment: 1 } } : {}),
      },
    });
    revalidatePath("/settings");
    return { ok: true, password };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another user already has that email." : msg };
  }
}
