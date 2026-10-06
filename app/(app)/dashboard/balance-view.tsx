"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownCircle, CalendarClock, Hourglass, Landmark, PiggyBank, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useChartTheme } from "@/components/dashboard/use-chart-theme";
import { Segmented } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatMonth } from "@/lib/i18n";
import { formatCompact, formatDate, formatMoney } from "@/lib/utils";
import type { CashDashboard } from "@/lib/cash";
import { salaryParts } from "@/lib/salary-parts";

const RANGES = [
  { value: "12", label: "12 months" },
  { value: "24", label: "24 months" },
  { value: "all", label: "All" },
] as const;

const INCOME = "#10B981";
const EXPENSE = "#F43F5E";

export function BalanceView({ cash, unpaid }: { cash: CashDashboard; unpaid: { amount: number; count: number } }) {
  const chart = useChartTheme();
  const { locale, t } = useI18n();
  const monthLabel = (m: string) => formatMonth(locale, m);
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("12");

  const thisMonth = new Date().toISOString().slice(0, 7);
  const completed = cash.months.filter((m) => m.month < thisMonth);
  const last = completed[completed.length - 1];
  const last3 = completed.slice(-3);
  const last12 = completed.slice(-12);
  const avg = (rows: typeof completed, f: (m: (typeof completed)[number]) => number) => (rows.length ? rows.reduce((s, m) => s + f(m), 0) / rows.length : 0);

  const cashNow = cash.months[cash.months.length - 1]?.closing ?? 0;
  const avgSpend = avg(last3, (m) => m.expense);
  const avgIncome = avg(last3, (m) => m.income);
  const runway = avgSpend > 0 ? cashNow / avgSpend : null;
  const runwayWithReceivables = avgSpend > 0 ? (cashNow + unpaid.amount) / avgSpend : null;
  const net = last ? last.income - last.expense : 0;
  const positiveMonths = last12.filter((m) => m.income - m.expense > 0).length;
  const spread = last3.length ? t("{0} to {1}", monthLabel(last3[0].month), monthLabel(last3[last3.length - 1].month)) : "—";

  const series = useMemo(() => {
    const cut = range === "all" ? cash.months : cash.months.slice(-Number(range));
    return cut.map((m) => ({ ...m, net: m.income - m.expense, label: formatMonth(locale, m.month, "short") }));
  }, [cash.months, range, locale]);

  const hint = (text: React.ReactNode) => <p className="text-[12px] text-ink-soft">{text}</p>;
  const months = (n: number | null) => (n === null ? "—" : t("{0} months", n.toFixed(1)));
  const tooltip = {
    contentStyle: { background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, color: chart.tooltipText, fontSize: 12 },
    formatter: (v: number, name: string) => [formatMoney(v), name] as [string, string],
  };
  const axes = (
    <>
      <CartesianGrid stroke={chart.grid} vertical={false} />
      <XAxis dataKey="label" stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
      <YAxis stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompact(Number(v))} width={52} />
    </>
  );

  const currencyTotal = cash.currencies.reduce((s, c) => s + Math.max(0, c.usd), 0) || 1;
  const spendTotal = cash.spending.reduce((s, c) => s + Math.max(0, c.usd), 0) || 1;
  const categoryLabel = (c: CashDashboard["spending"][number]) => (locale === "zh-CN" || !c.nameEn ? c.name : c.nameEn);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Landmark}
          label="Cash on hand"
          value={formatMoney(cashNow)}
          spark={cash.months.slice(-12).map((m) => m.closing)}
          footer={hint(t("All bank accounts, {0} currencies", cash.currencies.length))}
        />
        <KpiCard
          icon={net >= 0 ? TrendingUp : TrendingDown}
          tone={net >= 0 ? "success" : "danger"}
          label={last ? t("Operating cash flow · {0}", monthLabel(last.month)) : "Operating cash flow"}
          value={`${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net))}`}
          footer={hint(last ? t("Income {0} · expenses {1}", formatMoney(last.income), formatMoney(last.expense)) : t("No history yet"))}
        />
        <KpiCard icon={Scale} tone="danger" label="Avg monthly spend" value={formatMoney(avgSpend)} footer={hint(t("Operating expenses, {0}", spread))} />
        <KpiCard
          icon={Hourglass}
          tone={runway === null || runway >= 12 ? "success" : runway >= 6 ? "warning" : "danger"}
          label="Runway"
          value={months(runway)}
          footer={hint(t("Cash on hand ÷ average monthly spend"))}
        />
        <KpiCard icon={CalendarClock} tone="warning" label="Unpaid invoices" value={formatMoney(unpaid.amount)} footer={hint(t("{0} invoices sent, not paid", unpaid.count))} />
        <KpiCard
          icon={PiggyBank}
          label="Cash + receivables"
          value={formatMoney(cashNow + unpaid.amount)}
          footer={hint(t("Runway {0} once collected", months(runwayWithReceivables)))}
        />
        <KpiCard icon={ArrowDownCircle} tone="success" label="Avg monthly income" value={formatMoney(avgIncome)} footer={hint(t("Money received, {0}", spread))} />
        <KpiCard
          icon={TrendingUp}
          tone={positiveMonths >= last12.length / 2 ? "success" : "warning"}
          label="Cash-positive months"
          value={t("{0} of {1}", positiveMonths, last12.length)}
          footer={hint(t("Months in the last year where income beat expenses"))}
        />
      </div>

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold text-ink">{t("Cash balance per month")}</h2>
            <p className="text-[13px] text-ink-muted">{t("All accounts at month end, in USD at today's rates.")}</p>
          </div>
          <Segmented value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="cash-balance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.brand} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={chart.brand} stopOpacity={0} />
                </linearGradient>
              </defs>
              {axes}
              <Tooltip {...tooltip} />
              <Area dataKey="closing" name={t("Closing cash")} type="monotone" stroke={chart.brand} strokeWidth={2} fill="url(#cash-balance)" style={{ filter: chart.glow }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-ink">{t("Income and expenses per month")}</h2>
          <p className="text-[13px] text-ink-muted">{t("By month used. The line is operating cash flow: income minus expenses.")}</p>
        </div>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              {axes}
              <Tooltip cursor={{ fill: "rgba(84,112,214,0.08)" }} {...tooltip} />
              <Legend wrapperStyle={{ fontSize: 12, color: chart.axis }} />
              <Bar dataKey="income" name={t("Income")} fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expense" name={t("Expenses")} fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Line dataKey="net" name={t("Operating cash flow")} stroke={chart.brandBright} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="glass-panel neon-edge rounded-card p-5">
          <div className="flex items-start gap-3">
            <div className="mr-auto">
              <h2 className="text-base font-semibold text-ink">{t("Cash by currency")}</h2>
              <p className="text-[13px] text-ink-muted">{t("Where the money sits today, with the USD equivalent.")}</p>
            </div>
            <Link href="/cash" className="text-[13px] font-medium text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
              {t("All accounts")}
            </Link>
          </div>
          <ShareList
            rows={cash.currencies.map((c) => ({ key: c.currency, label: c.currency, sub: c.currency === "USD" ? "" : `${c.currency} ${formatMoney(c.native)}`, usd: c.usd }))}
            total={currencyTotal}
            empty={t("No cash lines yet.")}
          />
        </section>

        <section className="glass-panel neon-edge rounded-card p-5">
          <div className="flex items-start gap-3">
            <div className="mr-auto">
              <h2 className="text-base font-semibold text-ink">{t("Spending by category")}</h2>
              <p className="text-[13px] text-ink-muted">{t("Operating expenses over the last 12 completed months.")}</p>
            </div>
            <Link href="/cash/monthly" className="text-[13px] font-medium text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
              {t("Monthly statement")}
            </Link>
          </div>
          <ShareList
            rows={cash.spending.map((c) => ({
              key: c.id,
              label: categoryLabel(c),
              sub: locale === "zh-CN" ? c.nameEn && t(c.nameEn) : c.name,
              usd: c.usd,
              parts: c.byPurpose.length
                ? salaryParts(c.byPurpose)
                    .filter((p) => Math.abs(p.usd) >= 0.5)
                    .map((p) => ({ key: p.label, label: p.key && locale === "zh-CN" ? p.key : t(p.label), usd: p.usd }))
                : undefined,
            }))}
            total={spendTotal}
            tone="expense"
            empty={t("No expenses in the last 12 months.")}
          />
        </section>
      </div>

      <p className="px-1 text-[12px] text-ink-soft">
        {cash.ratesUpdatedAt ? t("Rates updated {0}", formatDate(cash.ratesUpdatedAt)) : t("No rates stored yet.")}{" "}
        {t("Past months are shown at today's rate, so their USD totals move when rates move.")}
      </p>
    </div>
  );
}

type ShareRow = { key: string; label: string; sub: string; usd: number; parts?: { key: string; label: string; usd: number }[] };

function ShareList({ rows, total, tone, empty }: { rows: ShareRow[]; total: number; tone?: "expense"; empty: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-[13px] text-ink-soft">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.usd), 1);
  return (
    <ul className="mt-4 space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink">
              {r.label}
              {r.sub && <span className="ml-2 text-[12px] text-ink-soft">{r.sub}</span>}
            </span>
            <span className="tnum shrink-0 text-ink">
              {formatMoney(r.usd, 0)}
              <span className="ml-2 inline-block w-10 text-right text-[12px] text-ink-soft">{Math.round((Math.max(0, r.usd) / total) * 100)}%</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-overlay/[0.06]">
            <div
              className={tone === "expense" ? "h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400" : "h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"}
              style={{ width: `${(Math.max(0, r.usd) / max) * 100}%` }}
            />
          </div>
          {r.parts && (
            <ul className="mt-2 space-y-1 border-l border-line pl-3">
              {r.parts.map((p) => (
                <li key={p.key} className="flex justify-between gap-3 text-[12px] text-ink-muted">
                  <span>{p.label}</span>
                  <span className="tnum">
                    {formatMoney(p.usd, 0)}
                    <span className="ml-2 inline-block w-10 text-right text-ink-soft">{Math.round((Math.max(0, p.usd) / total) * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
