"use client";

import { Info } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

/** An info icon that shows `children` on hover or keyboard focus. */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("group relative inline-flex", className)}>
      <button
        type="button"
        aria-label={t(label)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1.5 w-72 rounded-card border border-overlay/10 bg-surface/95 p-3 text-[12px] normal-case leading-relaxed tracking-normal text-ink-muted opacity-0 shadow-float backdrop-blur-2xl transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
