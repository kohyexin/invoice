"use client";

import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { useChartTheme } from "./use-chart-theme";
import { t } from "@/lib/i18n";

export function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = "%",
  icon: Icon,
  spark,
  invertDelta,
  tone = "brand",
  footer,
  live,
}: {
  label: string;
  value: string;
  delta?: number;
  deltaSuffix?: string;
  icon: LucideIcon;
  spark?: number[];
  invertDelta?: boolean;
  tone?: "brand" | "success" | "warning" | "danger";
  footer?: React.ReactNode;
  live?: boolean;
}) {
  const chart = useChartTheme();
  const positive = delta !== undefined && delta >= 0;
  const goodDirection = invertDelta ? !positive : positive;

  const toneMap = {
    brand: "bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
    success: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    warning: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    danger: "bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  };

  const sparkColor =
    tone === "danger" ? "#EF4444" : tone === "warning" ? "#F59E0B" : tone === "success" ? "#10B981" : chart.brand;
  // Keep unicode letters (e.g. Chinese labels) so ids stay unique per card.
  const sparkId = `spark-${label.replace(/[^\p{L}\p{N}]/gu, "")}`;

  return (
    <div className="glass-panel neon-edge rounded-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-brand">
      <div className="flex items-start justify-between">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneMap[tone])}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </span>
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              goodDirection
                ? "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
            )}
          >
            {positive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {Math.abs(delta)}
            {deltaSuffix}
          </span>
        )}
        {live && delta === undefined && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping-soft absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            {t("Live")}
          </span>
        )}
      </div>

      <p className="mt-4 text-sm font-medium text-ink-muted">{label}</p>
      <p className="tnum mt-1 text-2xl font-bold tracking-tight text-ink">{value}</p>

      {spark && (
        <div className="mt-3 h-9">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v) => ({ v }))} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
              <defs>
                <linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={sparkColor}
                strokeWidth={2}
                fill={`url(#${sparkId})`}
                style={{ filter: chart.glow }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
