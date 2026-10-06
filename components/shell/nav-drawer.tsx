"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { SidebarBrand } from "./sidebar-brand";
import { SidebarNav } from "./sidebar-nav";

/** Slide-in navigation for screens below lg, where the sidebar is hidden. */
export function NavDrawer({
  open,
  onClose,
  badges,
}: {
  open: boolean;
  onClose: () => void;
  badges?: Record<string, number>;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-canvas/60 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("Navigation")}
        className="glass-chrome absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-overlay/10 shadow-float animate-slide-in-left"
      >
        <div className="flex items-center justify-between border-b border-line pr-2">
          <div className="flex-1 p-3">
            <SidebarBrand onNavigate={onClose} />
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close navigation")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-overlay/[0.08] hover:text-ink"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <SidebarNav onNavigate={onClose} badges={badges} />
      </aside>
    </div>
  );
}
