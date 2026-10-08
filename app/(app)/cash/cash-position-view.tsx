"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, Coins, Landmark, Wallet } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { SortButton, sortRows, type SortAccessors, type SortState, nextSort } from "@/components/ui/sortable";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { CashAccountRow } from "@/lib/cash";

export function CashPositionView({
  accounts,
  rates,
  ratesUpdatedAt,
}: {
  accounts: CashAccountRow[];
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
}) {
  const { t } = useI18n();
  const [showEmpty, setShowEmpty] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const onSort = (key: string) => setSort((prev) => nextSort(prev, key));

  const total = accounts.reduce((s, a) => s + a.usd, 0);

  const companies = useMemo(() => {
    const map = new Map<string, { name: string; usd: number; accounts: CashAccountRow[] }>();
    for (const a of accounts) {
      const key = a.companyId || "none";
      const g = map.get(key) ?? { name: a.company || t("No company"), usd: 0, accounts: [] };
      g.usd += a.usd;
      g.accounts.push(a);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.usd - a.usd);
  }, [accounts, t]);

  // Same split as the workbook dashboard: CNY and CNH together.
  const byCurrency = useMemo(() => {
    const map = new Map<string, { native: number; usd: number }>();
    for (const a of accounts) {
      const key = a.currency === "CNH" ? "CNY" : a.currency;
      const c = map.get(key) ?? { native: 0, usd: 0 };
      c.native += a.balance;
      c.usd += a.usd;
      map.set(key, c);
    }
    return [...map.entries()].sort((a, b) => b[1].usd - a[1].usd);
  }, [accounts]);

  const hidden = accounts.filter((a) => Math.abs(a.balance) < 0.005).length;

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Wallet}
          label="Total cash (USD)"
          value={formatMoney(total)}
          footer={<Hint>{t("{0} accounts at the latest rate", accounts.length)}</Hint>}
        />
        {companies.slice(0, 3).map((c, i) => (
          <KpiCard
            key={c.name}
            icon={i === 0 ? Building2 : Landmark}
            tone={i === 0 ? "success" : "brand"}
            label={c.name}
            value={formatMoney(c.usd)}
            footer={<Hint>{c.accounts.length === 1 ? t("1 account") : t("{0} accounts", c.accounts.length)}</Hint>}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="glass-panel neon-edge rounded-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">{t("Accounts")}</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">{t("Balance is money in minus money out across every cash book line.")}</p>
            </div>
            {hidden > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(e) => setShowEmpty(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                />
                {t("Show {0} empty accounts", hidden)}
              </label>
            )}
          </div>
          <div className="overflow-x-auto px-5 pb-2">
            <table className="tnum w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="py-2.5 pr-3 font-semibold">
                    <SortButton sortKey="name" sort={sort} onSort={onSort}>{t("Account")}</SortButton>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    <SortButton sortKey="currency" sort={sort} onSort={onSort}>{t("Currency")}</SortButton>
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    <SortButton sortKey="balance" sort={sort} onSort={onSort}>{t("Balance")}</SortButton>
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    <SortButton sortKey="usd" sort={sort} onSort={onSort}>USD</SortButton>
                  </th>
                  <th className="py-2.5 pl-3 text-right font-semibold">
                    <SortButton sortKey="lastDate" sort={sort} onSort={onSort}>{t("Last line")}</SortButton>
                  </th>
                </tr>
              </thead>
              {companies.map((c) => {
                const rows = sortRows(
                  c.accounts.filter((a) => showEmpty || Math.abs(a.balance) >= 0.005),
                  sort,
                  ACCOUNT_SORT
                );
                if (rows.length === 0) return null;
                return (
                  <tbody key={c.name}>
                    <tr className="border-b border-line/60">
                      <td colSpan={3} className="pb-1.5 pt-4 text-[12px] font-semibold text-ink-muted">
                        {c.name}
                      </td>
                      <td className="pb-1.5 pt-4 text-right text-[12px] font-semibold text-ink-muted">{formatMoney(c.usd)}</td>
                      <td />
                    </tr>
                    {rows.map((a) => (
                      <tr key={a.id} className={cn("border-b border-line/60 last:border-0", Math.abs(a.balance) < 0.005 && "text-ink-soft")}>
                        <td className="py-3 pr-3">
                          <Link
                            href={`/cash/ledger?account=${a.id}`}
                            className="font-medium text-ink hover:text-brand-700 dark:hover:text-brand-200"
                          >
                            {a.name}
                          </Link>
                          {!a.active && (
                            <Badge tone="neutral" className="ml-2">
                              {t("Inactive")}
                            </Badge>
                          )}
                          <span className="block text-[12px] text-ink-soft">
                            {a.label} · {a.lines === 1 ? t("1 line") : t("{0} lines", a.lines)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-ink-muted">{a.currency}</td>
                        <td className="px-3 py-3 text-right">{formatMoney(a.balance)}</td>
                        <td className="px-3 py-3 text-right font-medium">{formatMoney(a.usd)}</td>
                        <td className="py-3 pl-3 text-right text-ink-muted">{formatDate(a.lastDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
              <tfoot>
                <tr className="border-t border-line">
                  <td colSpan={3} className="py-3 pr-3 font-semibold text-ink">
                    {t("Total")}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-ink">{formatMoney(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className="glass-panel neon-edge h-fit rounded-card">
          <div className="border-b border-line px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <Coins className="h-4 w-4 text-ink-soft" />
              {t("By currency")}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {t("Each currency total is converted once at the latest rate. CNH is counted with CNY.")}
            </p>
          </div>
          <ul className="tnum divide-y divide-line/60 px-5">
            {byCurrency.map(([cur, c]) => (
              <li key={cur} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <span className="font-medium text-ink">{cur}</span>
                  <span className="block text-[12px] text-ink-soft">
                    {cur === "USD" ? t("No conversion") : t("1 USD = {0} {1}", formatMoney(1 / (rates[cur] || 1), 4), cur)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-ink">{formatMoney(c.native)}</span>
                  <span className="block text-[12px] text-ink-soft">USD {formatMoney(c.usd)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-[12px] text-ink-soft">
            {ratesUpdatedAt ? t("Rates updated {0}", formatDate(ratesUpdatedAt)) : t("No rates stored yet.")}
          </p>
        </section>
      </div>
    </>
  );
}

const ACCOUNT_SORT: SortAccessors<CashAccountRow> = {
  name: (a) => a.name,
  currency: (a) => a.currency,
  balance: (a) => a.balance,
  usd: (a) => a.usd,
  lastDate: (a) => a.lastDate,
};

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink-soft">{children}</p>;
}
