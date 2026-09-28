import * as React from "react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type Tone = "neutral" | "success" | "danger" | "warning" | "brand" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-overlay/[0.06] text-ink-muted",
  success: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  danger: "bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  warning: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  brand: "bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
  outline: "border border-overlay/15 text-ink-muted",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  dot,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" && "bg-success",
            tone === "danger" && "bg-danger",
            tone === "warning" && "bg-warning",
            tone === "brand" && "bg-brand",
            tone === "neutral" && "bg-slate-400",
            tone === "outline" && "bg-slate-400"
          )}
        />
      )}
      {children}
    </span>
  );
}

/** Invoice status pill. SENT is the unpaid state. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    PAID: "success",
    SENT: "warning",
    END: "neutral",
    LOST: "danger",
    WAIVED: "outline",
  };
  return (
    <Badge tone={map[status] ?? "neutral"} dot>
      {t(status)}
    </Badge>
  );
}

export function GenerateBadge({ generate }: { generate: string }) {
  return (
    <Badge tone={generate === "SYSTEM" ? "brand" : "outline"}>
      {generate === "SYSTEM" ? "System" : "Manual"}
    </Badge>
  );
}
