"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { refreshRates } from "@/app/(app)/invoices/fx-actions";
import { cn } from "@/lib/utils";

export type FxState = { rates: Record<string, number>; updatedAt: string | null };

/** "1 USD = 7.8440 HKD · Yahoo Finance, 29 Sep 09:30 · Refresh" for the
 *  non-USD currencies an invoice involves. */
export function FxRateNote({
  currencies,
  fx,
  onChange,
  className,
}: {
  currencies: string[];
  fx: FxState;
  onChange: (next: FxState) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = Array.from(new Set(currencies.filter((c) => c && c !== "USD")));
  if (shown.length === 0) return null;

  const when = fx.updatedAt
    ? new Date(fx.updatedAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  function refresh() {
    setError(null);
    start(async () => {
      const res = await refreshRates();
      if (!res.ok) return setError(res.error);
      onChange({ rates: res.rates, updatedAt: res.updatedAt });
      if (res.failed.length) setError(t("No Yahoo Finance quote for {0}.", res.failed.join(", ")));
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft", className)}>
      {shown.map((c) => (
        <span key={c} className="tnum text-ink-muted">
          {fx.rates[c] ? `1 USD = ${(1 / fx.rates[c]).toFixed(4)} ${c}` : t("No rate for {0}", c)}
        </span>
      ))}
      <span>{when ? t("Yahoo Finance · {0}", when) : t("Yahoo Finance")}</span>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-900 disabled:opacity-60 dark:text-brand-200 dark:hover:text-brand-100"
      >
        <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
        {t(pending ? "Refreshing…" : "Refresh rate")}
      </button>
      {error && <span className="w-full text-rose-600 dark:text-rose-300">{t(error)}</span>}
    </div>
  );
}
