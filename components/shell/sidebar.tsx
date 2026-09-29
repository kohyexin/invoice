"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand/brand-logo";
import { useI18n } from "@/components/i18n/locale-provider";
import { AccountSwitcher } from "./account-switcher";
import { SidebarNav } from "./sidebar-nav";

export function Sidebar({
  collapsed,
  onToggle,
  badges,
}: {
  collapsed: boolean;
  onToggle: () => void;
  badges?: Record<string, number>;
}) {
  const { t } = useI18n();

  return (
    <aside
      className={cn(
        // Hidden below lg — mobile navigation lives in the NavDrawer instead.
        "glass-chrome sticky top-0 z-30 hidden h-screen shrink-0 flex-col border-r border-overlay/10 transition-[width] duration-200 lg:flex",
        collapsed ? "w-[76px]" : "w-[260px]"
      )}
    >
      <div className="p-3">
        <AccountSwitcher collapsed={collapsed} />
      </div>

      <SidebarNav collapsed={collapsed} badges={badges} />

      <div className="border-t border-line">
        <div className={cn("flex items-center gap-2 p-3", collapsed ? "flex-col justify-center" : "justify-between")}>
          <BrandLogo collapsed={collapsed} className={collapsed ? undefined : "pl-1.5"} />
          <button
            onClick={onToggle}
            aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
            className="flex h-8 w-8 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-overlay/[0.06] hover:text-ink"
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
