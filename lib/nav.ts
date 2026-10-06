import {
  BookOpen,
  CalendarRange,
  FilePlus2,
  FileText,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { RoleName } from "@/lib/roles";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  minRole?: RoleName;
  /** false: reachable from the profile menu and command palette only. */
  sidebar?: boolean;
};
export type NavGroup = { label?: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Invoicing",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText },
      { label: "New invoice", href: "/invoices/new", icon: FilePlus2, minRole: "STAFF" },
      { label: "System imports", href: "/imports", icon: Inbox, minRole: "STAFF" },
    ],
  },
  {
    label: "Balance sheet",
    items: [
      { label: "Cash position", href: "/cash", icon: Wallet },
      { label: "Cash book", href: "/cash/ledger", icon: BookOpen },
      { label: "Monthly statement", href: "/cash/monthly", icon: CalendarRange },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", href: "/clients", icon: Users },
      { label: "Settings", href: "/settings", icon: Settings, minRole: "ADMIN", sidebar: false },
    ],
  },
];
