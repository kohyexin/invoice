import {
  BookOpen,
  CalendarRange,
  FileCog,
  FilePen,
  FilePlus2,
  FileSignature,
  FileText,
  FileUp,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { can, isManager, type Feature, type Level, type RoleInfo } from "@/lib/roles";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Feature and level needed to see the item; none means everyone. */
  need?: [Feature, Level];
  /** Also shown to Owners and Admins without `need` (Settings holds Users and Roles). */
  managers?: boolean;
  /** false: reachable from the profile menu and command palette only. */
  sidebar?: boolean;
};
export type NavGroup = { label?: string; items: NavItem[] };

export function canSee(item: NavItem, role: RoleInfo) {
  if (!item.need) return true;
  return can(role, ...item.need) || (Boolean(item.managers) && isManager(role));
}

export const navGroups: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Invoicing",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText, need: ["invoices", "VIEW"] },
      { label: "New invoice", href: "/invoices/new", icon: FilePlus2, need: ["invoiceCreate", "EDIT"] },
      { label: "System imports", href: "/imports", icon: Inbox, need: ["systemImports", "VIEW"] },
    ],
  },
  {
    label: "Balance sheet",
    items: [
      { label: "Cash position", href: "/cash", icon: Wallet, need: ["cashReports", "VIEW"] },
      { label: "Cash book", href: "/cash/ledger", icon: BookOpen, need: ["cashBook", "VIEW"] },
      { label: "Monthly statement", href: "/cash/monthly", icon: CalendarRange, need: ["cashReports", "VIEW"] },
      { label: "Import statement", href: "/cash/import", icon: FileUp, need: ["statementImport", "VIEW"] },
    ],
  },
  {
    label: "Agreements",
    items: [
      { label: "Agreements", href: "/agreements", icon: FileSignature, need: ["agreements", "VIEW"] },
      { label: "New agreement", href: "/agreements/new", icon: FilePen, need: ["agreements", "EDIT"] },
      { label: "Agreement templates", href: "/agreements/templates", icon: FileCog, need: ["agreements", "EDIT"] },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", href: "/clients", icon: Users, need: ["clients", "VIEW"] },
      { label: "Settings", href: "/settings", icon: Settings, need: ["settings", "VIEW"], managers: true, sidebar: false },
    ],
  },
];
