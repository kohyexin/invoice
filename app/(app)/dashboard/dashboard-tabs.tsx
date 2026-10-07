"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";

export type DashboardTab = "invoices" | "balance";

/** A tab is null when the role can't see it; the switch only shows when both are allowed. */
export function DashboardTabs({ initial, invoices, balance }: { initial: DashboardTab; invoices: React.ReactNode | null; balance: React.ReactNode | null }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<DashboardTab>(initial === "balance" || !invoices ? "balance" : "invoices");
  const choose = (v: DashboardTab) => {
    setTab(v);
    window.history.replaceState(null, "", v === "balance" ? "/dashboard?view=balance" : "/dashboard");
  };

  if (!invoices && !balance)
    return (
      <div className="glass-panel neon-edge rounded-card px-5 py-12 text-center text-[13px] text-ink-soft">
        {t("Your role doesn't include anything to show here. Ask an Owner or Admin if you need access.")}
      </div>
    );
  if (!invoices || !balance) return <>{invoices ?? balance}</>;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          options={[
            { value: "invoices", label: "Invoices" },
            { value: "balance", label: "Balance" },
          ]}
          onChange={choose}
        />
        <span className="text-[13px] text-ink-soft">
          {tab === "balance" ? t("From the cash book. USD at today's rates.") : t("From the invoice ledger. USD as booked on each invoice.")}
        </span>
      </div>
      {tab === "balance" ? balance : invoices}
    </>
  );
}
