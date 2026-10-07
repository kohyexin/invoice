import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { can, effectivePermissions, isManager, type Feature, type Level, type RoleInfo } from "@/lib/roles";

export type CurrentUser = { id: string; email: string; name: string; role: RoleInfo };

/** The signed-in user, or null when the session is missing, expired,
 *  revoked (version bumped) or the account is disabled. Once per request,
 *  so a role change applies from the user's next request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: {
      id: true,
      email: true,
      name: true,
      active: true,
      sessionVersion: true,
      role: { select: { id: true, name: true, system: true, permissions: true } },
    },
  });
  if (!user || !user.active || user.sessionVersion !== claims.version) return null;
  const { role } = user;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: { id: role.id, name: role.name, system: role.system, permissions: effectivePermissions(role.system, role.permissions) },
  };
});

/** For pages: sends the visitor to sign in, or to the dashboard when their
 *  role doesn't reach `level` on `feature`. Without a feature, any signed-in user. */
export async function requirePage(feature?: Feature, level: Level = "VIEW") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (feature && !can(user.role, feature, level)) redirect("/dashboard");
  return user;
}

/** For pages only Owners and Admins may open. */
export async function requireManagerPage() {
  const user = await requirePage();
  if (!isManager(user.role)) redirect("/dashboard");
  return user;
}

export class AccessError extends Error {}

/** For server actions and API routes. Without a feature, any signed-in user. */
export async function requireAccess(feature?: Feature, level: Level = "VIEW") {
  const user = await getCurrentUser();
  if (!user) throw new AccessError("Your session has ended. Sign in again.");
  if (feature && !can(user.role, feature, level)) throw new AccessError("You do not have permission to do this.");
  return user;
}

/** For API routes: a 401/403 response to return, or null to carry on. */
export async function apiDenied(feature?: Feature, level: Level = "VIEW") {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (feature && !can(user.role, feature, level)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

type Authorized = { ok: true; user: CurrentUser } | { ok: false; error: string };

async function attempt(check: () => Promise<CurrentUser>): Promise<Authorized> {
  try {
    return { ok: true, user: await check() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Not allowed." };
  }
}

/** For server actions that return `{ ok: false, error }` to their forms:
 *  `const auth = await authorize("clients", "EDIT"); if (!auth.ok) return auth;` */
export function authorize(feature?: Feature, level: Level = "VIEW"): Promise<Authorized> {
  return attempt(() => requireAccess(feature, level));
}

/** Owners and Admins only: users and roles. */
export function authorizeManager(): Promise<Authorized> {
  return attempt(async () => {
    const user = await requireAccess();
    if (!isManager(user.role)) throw new AccessError("Only an Owner or Admin can do this.");
    return user;
  });
}
