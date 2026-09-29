import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Role } from "@/lib/generated/prisma/client";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { hasRole } from "@/lib/roles";

export type CurrentUser = { id: string; email: string; name: string; role: Role };

/** The signed-in user, or null when the session is missing, expired,
 *  revoked (version bumped) or the account is disabled. Once per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, role: true, active: true, sessionVersion: true },
  });
  if (!user || !user.active || user.sessionVersion !== claims.version) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/** For pages: sends the visitor to sign in, or to the dashboard when their
 *  role is too low. */
export async function requirePageRole(min: Role) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasRole(user.role, min)) redirect("/dashboard");
  return user;
}

export class AccessError extends Error {}

/** For server actions and API routes. */
export async function requireRole(min: Role) {
  const user = await getCurrentUser();
  if (!user) throw new AccessError("Your session has ended. Sign in again.");
  if (!hasRole(user.role, min)) throw new AccessError("You do not have permission to do this.");
  return user;
}

/** For API routes: a 401/403 response to return, or null to carry on. */
export async function apiDenied(min: Role) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasRole(user.role, min)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

/** For server actions that return `{ ok: false, error }` to their forms:
 *  `const auth = await authorize("STAFF"); if (!auth.ok) return auth;` */
export async function authorize(
  min: Role
): Promise<{ ok: true; user: CurrentUser } | { ok: false; error: string }> {
  try {
    return { ok: true, user: await requireRole(min) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not allowed." };
  }
}
