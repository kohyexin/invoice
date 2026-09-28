"use client";

/* Shared form atoms used by both the Global Components drawer and the
 * full-page CatalogEditorShell flows. Keep these in one place so every
 * entity editor (current + future) renders identical fields and toggles. */

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export const fieldClass =
  "h-10 w-full rounded-control border border-overlay/10 bg-overlay/[0.04] px-3 text-sm text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25";

/* Native <select> with the browser arrow removed and a single, consistently
 * positioned chevron — keeps dropdowns visually aligned with the custom
 * multi-select controls (no more arrow stuck in the far corner). */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn(fieldClass, "appearance-none pr-9", className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
    </div>
  );
}

export const labelClass = "mb-1.5 block text-[13px] font-medium text-ink";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-ink-soft">{hint}</p>}
    </div>
  );
}

/* Read-only Active/Inactive pill — activation is managed from the catalog
 * list (table Power action), never inside an editor. */
export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        active
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : "bg-overlay/10 text-ink-soft"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-ink-soft/60")} />
      {active ? t("Active") : t("Inactive")}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-control border border-overlay/10 bg-overlay/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-all",
            value === o.value
              ? "bg-brand text-white shadow-glow-brand"
              : "text-ink-muted hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
