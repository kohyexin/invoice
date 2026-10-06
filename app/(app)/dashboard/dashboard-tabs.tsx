"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";

export type DashboardTab = "invoices" | "balance";

export function DashboardTabs({ initial, invoices, balance }: { initial: DashboardTab; invoices: React.ReactNode; balance: React.ReactNode }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initial);
  const choose = (v: DashboardTab) => {
    setTab(v);
    window.history.replaceState(null, "", v === "balance" ? "/dashboard?view=balance" : "/dashboard");
  };

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
