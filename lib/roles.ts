/* Roles grant a level per feature. Owner and Admin are fixed in code; every
 * other role keeps its levels in AppRole.permissions. Shared by server and
 * client, so no server imports here. */

export type Level = "NONE" | "VIEW" | "EDIT";
export type SystemRoleName = "OWNER" | "ADMIN";

export const FEATURES = [
  {
    key: "dashboard",
    label: "Dashboard",
    help: "Basic shows counts only. Full adds amounts, best and median month, and the Balance tab.",
    levels: ["VIEW", "EDIT"],
    names: { VIEW: "Basic", EDIT: "Full" },
  },
  {
    key: "invoices",
    label: "Invoices",
    help: "View: list, details and PDFs. Edit: record invoices, change ledger entries, mark paid, change status, delete, refresh FX.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "invoiceCreate",
    label: "Create invoices",
    help: "New invoice, and editing invoices made in the app.",
    levels: ["NONE", "EDIT"],
  },
  {
    key: "systemImports",
    label: "System imports",
    help: "View: the import queue and PDFs. Edit: check the mailbox, upload, approve, reject and restore.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "clients",
    label: "Clients",
    help: "Edit: add, change and delete clients, Jotform import.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "cashReports",
    label: "Cash position and monthly statement",
    help: "Balances by account, the monthly statement and the dashboard Balance tab.",
    levels: ["NONE", "VIEW"],
  },
  {
    key: "cashBook",
    label: "Cash book",
    help: "Every bank line. Edit: add, change and delete lines.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "statementImport",
    label: "Import statement",
    help: "View: statements and the approval queue. Edit: upload bank PDFs, approve and reject lines.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "agreements",
    label: "Agreements",
    help: "View: agreements and their PDFs. Edit: agreement templates, and new agreements, which add or update the client and archive the PDF on Google Drive.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
  {
    key: "settings",
    label: "Settings",
    help: "Companies, bank accounts, payment defaults, FX rates, owners, invoice types and items, cash categories, Google Drive.",
    levels: ["NONE", "VIEW", "EDIT"],
  },
] as const satisfies readonly { key: string; label: string; help: string; levels: readonly Level[]; names?: Partial<Record<Level, string>> }[];

export type Feature = (typeof FEATURES)[number]["key"];
export type Permissions = Record<Feature, Level>;

export const LEVEL_NAME: Record<Level, string> = { NONE: "None", VIEW: "View", EDIT: "Edit" };

export function levelName(feature: Feature, level: Level): string {
  const f = FEATURES.find((x) => x.key === feature);
  const names = f && "names" in f ? (f.names as Partial<Record<Level, string>>) : undefined;
  return names?.[level] ?? LEVEL_NAME[level];
}

const RANK: Record<Level, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

/** Cleans stored permissions: unknown features dropped, each level clamped to
 *  what the feature allows (missing means its lowest level). */
export function normalizePermissions(raw: unknown): Permissions {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Permissions;
  for (const f of FEATURES) {
    const allowed = f.levels as readonly Level[];
    const v = src[f.key];
    out[f.key] = typeof v === "string" && allowed.includes(v as Level) ? (v as Level) : allowed[0];
  }
  return out;
}

const full = (): Permissions => Object.fromEntries(FEATURES.map((f) => [f.key, f.levels[f.levels.length - 1]])) as Permissions;

/** What a role can actually do. */
export function effectivePermissions(system: SystemRoleName | null, stored: unknown): Permissions {
  if (system === "OWNER") return full();
  if (system === "ADMIN") return { ...full(), cashBook: "VIEW", statementImport: "VIEW" };
  return normalizePermissions(stored);
}

export const SYSTEM_ROLE_HELP: Record<SystemRoleName, string> = {
  OWNER: "Full access, including users, roles and other Owners.",
  ADMIN: "Everything except changing the cash book and statement imports. Manages users and roles, but not Owners.",
};

/** A role's display name. "Owner" already means an invoice's account owner in
 *  the dictionary, so the Owner role has its own key. */
export function roleLabel(t: (s: string) => string, role: { name: string; system: SystemRoleName | null }) {
  return role.system === "OWNER" ? t("Owner (role)").replace(/ \(role\)$/, "") : t(role.name);
}

export type RoleInfo = { id: string; name: string; system: SystemRoleName | null; permissions: Permissions };

export function can(role: Pick<RoleInfo, "permissions">, feature: Feature, level: Level = "VIEW") {
  return RANK[role.permissions[feature]] >= RANK[level];
}

export const isOwner = (role: Pick<RoleInfo, "system">) => role.system === "OWNER";
/** Owner or Admin: may manage users and roles. */
export const isManager = (role: Pick<RoleInfo, "system">) => role.system !== null;
