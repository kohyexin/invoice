"use client";

import { createContext, useContext } from "react";
import { hasRole, type RoleName } from "@/lib/roles";

export type SessionUser = { id: string; email: string; name: string; role: RoleName };

const UserContext = createContext<SessionUser | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useCurrentUser() {
  const user = useContext(UserContext);
  if (!user) throw new Error("useCurrentUser must be used inside the app layout");
  return user;
}

/** Whether the signed-in user may do things that need `min`. Display only;
 *  the server checks again. */
export function useCan(min: RoleName) {
  return hasRole(useCurrentUser().role, min);
}
