import {
  FilePlus2,
  FileText,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavGroup = { label?: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Invoicing",
    items: [
      { label: "Invoices", href: "/invoices", icon: FileText },
      { label: "New invoice", href: "/invoices/new", icon: FilePlus2 },
      { label: "System imports", href: "/imports", icon: Inbox },
    ],
  },
  {
    label: "Records",
    items: [
      { label: "Clients", href: "/clients", icon: Users },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];
