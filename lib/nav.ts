import {
  FilePlus2,
  FileText,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { RoleName } from "@/lib/roles";

export type NavItem = { label: string; href: string; icon: LucideIcon; minRole?: RoleName };
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
    label: "Records",
    items: [
      { label: "Clients", href: "/clients", icon: Users },
      { label: "Settings", href: "/settings", icon: Settings, minRole: "ADMIN" },
    ],
  },
];
