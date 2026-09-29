"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navGroups } from "@/lib/nav";
import { hasRole } from "@/lib/roles";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCurrentUser } from "./user-context";

function isActive(pathname: string, href: string) {
  if (href === "/invoices") return pathname === "/invoices" || /^\/invoices\/(?!new)/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  collapsed = false,
  onNavigate,
  badges = {},
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const { role } = useCurrentUser();
  const { t } = useI18n();
  const groups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.sidebar !== false && (!i.minRole || hasRole(role, i.minRole))) }))
    .filter((g) => g.items.length > 0);

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4">
      {groups.map((group, gi) => (
        <div key={gi} className="mb-1">
          {group.label && !collapsed && (
            <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {t(group.label)}
            </p>
          )}
          {group.label && collapsed && gi > 0 && <div className="mx-auto my-2 h-px w-6 bg-line" />}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              const badge = badges[item.href];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? t(item.label) : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-control px-2.5 py-2 text-sm font-medium transition-colors",
                      collapsed && "justify-center",
                      active
                        ? "bg-brand-500/10 text-brand-700 shadow-[inset_0_0_0_1px_rgb(var(--brand-500)/0.2)] dark:text-brand-200 dark:shadow-[inset_0_0_0_1px_rgb(var(--brand-500)/0.25)]"
                        : "text-ink-muted hover:bg-overlay/[0.05] hover:text-ink"
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand shadow-[0_0_8px_0_rgb(var(--brand-500)/0.7)] dark:shadow-[0_0_8px_0_rgb(var(--brand-500)/0.8)]" />
                    )}
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                    {!collapsed && <span className="flex-1">{t(item.label)}</span>}
                    {!collapsed && badge ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">
                        {badge}
                      </span>
                    ) : null}
                    {collapsed && badge ? (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
