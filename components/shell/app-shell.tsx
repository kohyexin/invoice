"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ShellAlerts } from "@/lib/shell-alerts";
import { AppBackdrop } from "./app-backdrop";
import { Header } from "./header";
import { NavDrawer } from "./nav-drawer";
import { Sidebar } from "./sidebar";

const COLLAPSE_KEY = "inv-sidebar-collapsed";

export function AppShell({ children, alerts }: { children: React.ReactNode; alerts: ShellAlerts }) {
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();
  const badges = alerts.imports?.count ? { "/imports": alerts.imports.count } : undefined;

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => setNavOpen(false), [pathname]);

  function toggle() {
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  return (
    <div className="relative flex min-h-screen">
      <AppBackdrop />

      <Sidebar collapsed={collapsed} onToggle={toggle} badges={badges} />
      <NavDrawer open={navOpen} onClose={() => setNavOpen(false)} badges={badges} />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Header alerts={alerts} onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 px-4 py-5 sm:px-6 sm:py-7 xl:px-10">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
