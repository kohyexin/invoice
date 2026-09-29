export type RoleName = "ADMIN" | "STAFF" | "VIEWER";

const RANK: Record<RoleName, number> = { VIEWER: 0, STAFF: 1, ADMIN: 2 };

export function hasRole(role: RoleName, min: RoleName) {
  return RANK[role] >= RANK[min];
}

export const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: "Admin",
  STAFF: "Staff",
  VIEWER: "Viewer",
};

export const ROLE_HELP: Record<RoleName, string> = {
  ADMIN: "Everything, including users and settings.",
  STAFF: "Create and edit invoices and clients, record payments, run imports.",
  VIEWER: "Read-only: dashboard, invoices, clients and PDFs.",
};
