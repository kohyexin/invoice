"use client";

import { createContext, useContext } from "react";
import { can, isManager, type Feature, type Level, type RoleInfo } from "@/lib/roles";

export type SessionUser = { id: string; email: string; name: string; role: RoleInfo };

const UserContext = createContext<SessionUser | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useCurrentUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error("useCurrentUser must be used inside the app layout");
  return user;
}

/** Whether the signed-in user reaches `level` on `feature`. Display only;
 *  the server checks again. */
export function useCan(feature: Feature, level: Level = "VIEW") {
  return can(useCurrentUser().role, feature, level);
}

/** Owner or Admin. */
export function useIsManager() {
  return isManager(useCurrentUser().role);
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login");
}
