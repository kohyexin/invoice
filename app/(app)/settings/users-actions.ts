"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import { sha256 } from "@/lib/mfa";
import { generatePassword, hashPassword } from "@/lib/passwords";
import { isOwner } from "@/lib/roles";
import { authorizeManager, type CurrentUser } from "@/lib/session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const INVITE_TTL_HOURS = 72;
const OWNER_ONLY = "Only an Owner can give the Owner role or change an Owner.";

/** The role being assigned, if it exists and the actor may hand it out. */
async function assignableRole(me: CurrentUser, roleId: string) {
  const role = await prisma.appRole.findUnique({ where: { id: roleId }, select: { id: true, name: true, system: true } });
  if (!role) return { ok: false as const, error: "Pick a role." };
  if (role.system === "OWNER" && !isOwner(me.role)) return { ok: false as const, error: OWNER_ONLY };
  return { ok: true as const, role };
}
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

async function deliver(email: string, token: string, inviterName: string, roleName: string) {
  const link = `${origin()}/invite/${token}`;
  const result = await sendInviteEmail(email, link, inviterName, roleName);
  const emailed: Delivery = result.mocked ? "logged" : result.sent ? "sent" : "failed";
  return { link, emailed };
}

type Delivery = "sent" | "logged" | "failed";

/** Invites someone by email. They have no password until they accept the
 *  link, so they can't sign in before then. The link is also returned so the
 *  admin can pass it on if the email doesn't arrive. */
export async function inviteUser(input: Record<string, unknown>): Promise<Result<{ link: string; emailed: Delivery }>> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  const picked = await assignableRole(auth.user, String(input.roleId ?? ""));
  if (!picked.ok) return picked;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "Another user already has that email." };

  const { token, data } = newInvite();
  try {
    await prisma.user.create({ data: { email, name, roleId: picked.role.id, active: true, passwordHash: "", invitedById: auth.user.id, ...data } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another user already has that email." : msg };
  }
  const sent = await deliver(email, token, auth.user.name || auth.user.email, picked.role.name);
  const created = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  await logActivity(auth.user, { action: "invite", entity: "user", entityId: created?.id, label: email, changes: { role: picked.role.name, name: name || null } });
  revalidatePath("/settings");
  return { ok: true, ...sent };
}

/** Sends a new invitation link; the previous one stops working. */
export async function resendInvite(id: string): Promise<Result<{ link: string; emailed: Delivery }>> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const user = await prisma.user.findUnique({ where: { id }, select: { email: true, role: { select: { name: true, system: true } }, passwordHash: true } });
  if (!user) return { ok: false, error: "That user no longer exists." };
  if (user.passwordHash) return { ok: false, error: "This user has already accepted their invitation." };
  if (user.role.system === "OWNER" && !isOwner(auth.user.role)) return { ok: false, error: OWNER_ONLY };

  const { token, data } = newInvite();
  await prisma.user.update({ where: { id }, data: { ...data, invitedById: auth.user.id } });
  const sent = await deliver(user.email, token, auth.user.name || auth.user.email, user.role.name);
  await logActivity(auth.user, { action: "resend_invite", entity: "user", entityId: id, label: user.email });
  revalidatePath("/settings");
  return { ok: true, ...sent };
}

/** Edits an existing user. With `resetPassword` ticked they get a generated
 *  password, returned once so the admin can pass it on. */
export async function saveUser(id: string, input: Record<string, unknown>): Promise<Result<{ password?: string }>> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const roleId = String(input.roleId ?? "");
  const active = Boolean(input.active);

  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };

  const self = id === auth.user.id;
  if (self && roleId !== auth.user.role.id) return { ok: false, error: "You can't change your own role. Ask another Owner." };
  if (self && !active) return { ok: false, error: "You can't disable your own account." };

  try {
    const before = await prisma.user.findUnique({
      where: { id },
      select: { email: true, roleId: true, role: { select: { name: true, system: true } }, active: true, name: true, passwordHash: true },
    });
    if (!before) return { ok: false, error: "That user no longer exists." };
    if (before.role.system === "OWNER" && !isOwner(auth.user.role)) return { ok: false, error: OWNER_ONLY };
    const picked = await assignableRole(auth.user, roleId);
    if (!picked.ok) return picked;
    const pending = !before.passwordHash;
    if (!name && !pending) return { ok: false, error: "Name is required." };
    if (before.role.system === "OWNER" && before.active && !pending && (picked.role.system !== "OWNER" || !active)) {
      const owners = await prisma.user.count({ where: { role: { system: "OWNER" }, active: true, NOT: { passwordHash: "" } } });
      if (owners <= 1) return { ok: false, error: "This is the only active Owner. Make someone else an Owner first." };
    }

    // A pending invitee sets their own password when they accept.
    const password = input.resetPassword && !pending ? generatePassword() : undefined;
    const resetTwoFactor = Boolean(input.resetTwoFactor) && !pending;
    await prisma.user.update({
      where: { id },
      data: {
        email,
        name,
        roleId: picked.role.id,
        active,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
        // They enrol a new authenticator on their next sign-in.
        ...(resetTwoFactor ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, emailCodeHash: null } : {}),
        // Signs the user out on every device and forgets remembered browsers.
        ...(password || resetTwoFactor || (before.active && !active) ? { sessionVersion: { increment: 1 } } : {}),
      },
    });
    await logActivity(auth.user, {
      action: "update",
      entity: "user",
      entityId: id,
      label: email,
      before: { email: before.email, name: before.name, role: before.role.name, active: before.active },
      after: { email, name, role: picked.role.name, active },
      changes: {
        ...(password ? { password: "reset" } : {}),
        ...(resetTwoFactor ? { twoFactor: "reset" } : {}),
      },
    });
    revalidatePath("/settings");
    return { ok: true, password };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("Unique constraint") ? "Another user already has that email." : msg };
  }
}
