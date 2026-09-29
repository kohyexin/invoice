"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AppBackdrop } from "./app-backdrop";
import { BrandLogo } from "./brand-logo";
import { hasRole, ROLE_LABEL } from "@/lib/roles";
import { SidebarNav } from "./sidebar-nav";
import { useCurrentUser } from "./user-context";

const COLLAPSE_KEY = "inv-sidebar-collapsed";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function AppShell({
  children,
  badges,
}: {
  children: React.ReactNode;
  badges?: Record<string, number>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const user = useCurrentUser();
  const canEdit = hasRole(user.role, "STAFF");

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => setDrawerOpen(false), [pathname]);

  function toggle() {
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const footer = (isCollapsed: boolean) => (
    <div className="border-t border-line p-3">
      <Link
        href="/account"
        title={isCollapsed ? `${user.name} · ${ROLE_LABEL[user.role]}` : "My account"}
        className={cn(
          "mb-2 flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors hover:bg-overlay/[0.05]",
          isCollapsed && "justify-center px-0",
          pathname === "/account" && "bg-brand-500/15"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[13px] font-semibold text-brand-200">
          {initials(user.name)}
        </span>
        {!isCollapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
            <span className="block truncate text-[11px] text-ink-soft">{ROLE_LABEL[user.role]}</span>
          </span>
        )}
      </Link>
      <div className={cn("flex items-center gap-2", isCollapsed ? "flex-col" : "justify-between")}>
        <BrandLogo collapsed={isCollapsed} />
        <div className={cn("flex items-center gap-1", isCollapsed && "flex-col")}>
          <button
            onClick={signOut}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-overlay/[0.06] hover:text-ink"
          >
            <LogOut className="h-[17px] w-[17px]" />
          </button>
          <button
            onClick={toggle}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-8 w-8 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-overlay/[0.06] hover:text-ink lg:flex"
          >
            {isCollapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-screen">
      <AppBackdrop />

      <aside
        className={cn(
          "glass-chrome sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-overlay/10 transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-[248px]"
        )}
      >
        <div className={cn("p-3", !canEdit && "hidden")}>
          <Link
            href="/invoices/new"
            title="New invoice"
            className={cn(
              "flex h-10 items-center justify-center gap-2 rounded-control bg-gradient-to-r from-brand-600 to-brand-400 text-sm font-semibold text-white shadow-glow-brand transition hover:brightness-110",
              collapsed ? "w-full" : "w-full px-3"
            )}
          >
            <Plus className="h-4 w-4" />
            {!collapsed && "New invoice"}
          </Link>
        </div>
        <SidebarNav collapsed={collapsed} badges={badges} />
        {footer(collapsed)}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-canvas/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="glass-chrome absolute left-0 top-0 flex h-full w-[260px] flex-col border-r border-overlay/10 animate-slide-in-left">
            <div className="flex justify-end p-3">
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav badges={badges} onNavigate={() => setDrawerOpen(false)} />
            {footer(false)}
          </aside>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass-chrome sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-overlay/10 px-4 lg:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
          >
            <Menu className="h-5 w-5" />
          </button>
          <BrandLogo />
        </header>
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-7 xl:px-10">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
