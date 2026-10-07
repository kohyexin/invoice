"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, Check, CheckCircle2, Hourglass, Receipt, Trophy, Users, XCircle } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useChartTheme } from "@/components/dashboard/use-chart-theme";
import { BrandLogo } from "@/components/brand/brand-logo";
import { CopyImageButton } from "@/components/ui/copy-image-button";
import { Segmented } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatMonth } from "@/lib/i18n";
import { cn, formatCompact, formatDate, formatMoney } from "@/lib/utils";

type Bucket = { amount: number; count: number };

export type DashboardData = {
  totals: { all: Bucket; paid: Bucket; unpaid: Bucket; endLost: Bucket; waived: Bucket };
  clientCount: number;
  activeClients: number;
  thisMonth: { month: string; billed: number; count: number; received: number };
  best: { month: string; billed: number; count: number } | null;
  medianMonth: number;
  monthly: { month: string; billed: number; count: number; received: number }[];
  unpaid: { clientId: string; name: string; amount: number; count: number; oldest: string; byMonth: Record<string, number> }[];
  activeByType: { type: string; clients: number }[];
  recentMonths: string[];
  recentClients: { clientId: string; name: string; byType: Record<string, Record<string, number>> }[];
};

const RANGES = [
  { value: "12", label: "12 months" },
  { value: "24", label: "24 months" },
  { value: "all", label: "All" },
] as const;

/** `basic`: the server sent counts only, so every amount is shown as a count instead. */
export function DashboardView({ data, basic = false }: { data: DashboardData; basic?: boolean }) {
  const chart = useChartTheme();
  const { locale, t } = useI18n();
  const monthLabel = (m: string) => formatMonth(locale, m);
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("12");
  const [typeFilter, setTypeFilter] = useState("All");
  const [unpaidView, setUnpaidView] = useState<"summary" | "months">("summary");
  const { totals } = data;

  const series = useMemo(() => {
    const all = data.monthly;
    const cut = range === "all" ? all : all.slice(-Number(range));
    return cut.map((m) => ({ ...m, label: formatMonth(locale, m.month, "short") }));
  }, [data.monthly, range, locale]);

  const recent = data.recentClients
    .filter((c) => typeFilter === "All" || c.byType[typeFilter])
    .map((c) => {
      const months: Record<string, number> = {};
      for (const [type, byMonth] of Object.entries(c.byType)) {
        if (typeFilter !== "All" && type !== typeFilter) continue;
        for (const [m, v] of Object.entries(byMonth)) months[m] = (months[m] ?? 0) + v;
      }
      return { ...c, months };
    });
  const hint = (text: React.ReactNode) => <p className="text-[12px] text-ink-soft">{text}</p>;

  return (
    <div className="space-y-6">
      {basic ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <KpiCard icon={Receipt} label="Invoices issued" value={String(totals.all.count)} footer={hint(t("All time"))} />
          <KpiCard icon={CheckCircle2} tone="success" label="Paid" value={String(totals.paid.count)} footer={hint(t("Invoices"))} />
          <KpiCard icon={Hourglass} tone="warning" label="Unpaid" value={String(totals.unpaid.count)} footer={hint(t("Invoices sent, not paid"))} />
          <KpiCard icon={XCircle} tone="danger" label="End / lost" value={String(totals.endLost.count)} footer={hint(t("{0} waived", totals.waived.count))} />
          <KpiCard icon={Users} label="Clients" value={String(data.clientCount)} footer={hint(t("{0} billed in the last 3 months", data.activeClients))} />
          <KpiCard icon={CalendarDays} label={t("This month · {0}", monthLabel(data.thisMonth.month))} value={String(data.thisMonth.count)} footer={hint(t("Invoices"))} />
        </div>
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Receipt} label="Total invoiced" value={formatMoney(totals.all.amount)} footer={hint(t("{0} invoices issued", totals.all.count))} />
        <KpiCard icon={CheckCircle2} tone="success" label="Paid" value={formatMoney(totals.paid.amount)} footer={hint(t("{0} invoices", totals.paid.count))} />
        <KpiCard icon={Hourglass} tone="warning" label="Unpaid" value={formatMoney(totals.unpaid.amount)} footer={hint(t("{0} invoices sent, not paid", totals.unpaid.count))} />
        <KpiCard
          icon={XCircle}
          tone="danger"
          label="End / lost"
          value={formatMoney(totals.endLost.amount)}
          footer={hint(t("{0} invoices · {1} waived ({2})", totals.endLost.count, totals.waived.count, formatMoney(totals.waived.amount)))}
        />
        <KpiCard icon={Users} label="Clients" value={String(data.clientCount)} footer={hint(t("{0} billed in the last 3 months", data.activeClients))} />
        <KpiCard
          icon={CalendarDays}
          label={t("This month · {0}", monthLabel(data.thisMonth.month))}
          value={formatMoney(data.thisMonth.billed)}
          footer={hint(t("{0} invoices · {1} received", data.thisMonth.count, formatMoney(data.thisMonth.received)))}
        />
        <KpiCard
          icon={Trophy}
          tone="success"
          label="Best month"
          value={data.best ? formatMoney(data.best.billed) : "—"}
          footer={hint(data.best ? t("{0} · {1} invoices", monthLabel(data.best.month), data.best.count) : t("No history yet"))}
        />
        <KpiCard icon={BarChart3} label="Median month" value={formatMoney(data.medianMonth)} footer={hint(t("Across completed months"))} />
      </div>
      )}

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold text-ink">{t(basic ? "Invoices per month" : "Invoiced and received per month")}</h2>
            <p className="text-[13px] text-ink-muted">{t(basic ? "Number of invoices by invoice date." : "Bars by invoice date, line by received date.")}</p>
          </div>
          <Segmented value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis
                stroke={chart.axis}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => (basic ? String(v) : formatCompact(Number(v)))}
                allowDecimals={!basic}
                width={52}
              />
              <Tooltip
                cursor={{ fill: "rgba(84,112,214,0.08)" }}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, color: chart.tooltipText, fontSize: 12 }}
                formatter={(v: number, name: string) => [basic ? String(v) : formatMoney(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: chart.axis }} />
              {basic ? (
                <Bar dataKey="count" name={t("Invoices")} fill={chart.brand} radius={[4, 4, 0, 0]} maxBarSize={28} />
              ) : (
                <Bar dataKey="billed" name={t("Invoiced")} fill={chart.brand} radius={[4, 4, 0, 0]} maxBarSize={28} />
              )}
              {!basic && (
                <Line dataKey="received" name={t("Received")} stroke={chart.brandBright} strokeWidth={2} dot={false} style={{ filter: "drop-shadow(0 0 5px rgba(34,211,238,0.6))" }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className={cn("grid gap-6", unpaidView === "summary" && "xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <section className="glass-panel neon-edge min-w-0 rounded-card p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="mr-auto">
              <h2 className="text-base font-semibold text-ink">{t("Unpaid by client")}</h2>
              <p className="text-[13px] text-ink-muted">
                {t(unpaidView === "summary" ? "Invoices with status SENT, by client A–Z." : "Unpaid USD by invoice month, by client A–Z.")}
              </p>
            </div>
            {!basic && (
              <Segmented
                value={unpaidView}
                options={[
                  { value: "summary", label: "Summary" },
                  { value: "months", label: "By month" },
                ]}
                onChange={setUnpaidView}
              />
            )}
          </div>
          {unpaidView === "months" ? (
            <UnpaidByMonth rows={data.unpaid} monthLabel={monthLabel} />
          ) : (
          <div className="relative mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="py-2 pr-3">{t("Client")}</th>
                  <th className="py-2 pr-3 text-right">{t("Invoices")}</th>
                  <th className="py-2 pr-3">{t("Oldest")}</th>
                  {!basic && <th className="py-2 text-right">{t("Unpaid")}</th>}
                </tr>
              </thead>
              <tbody>
                {data.unpaid.map((u) => (
                  <tr key={u.clientId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/clients/${u.clientId}`} className="text-ink hover:text-brand-700 dark:hover:text-brand-200">
                        {u.name}
                      </Link>
                    </td>
                    <td className="tnum py-2 pr-3 text-right text-ink-muted">{u.count}</td>
                    <td className="py-2 pr-3 text-ink-muted">{formatDate(u.oldest)}</td>
                    {!basic && <td className="tnum py-2 text-right text-amber-600 dark:text-amber-300">{formatMoney(u.amount)}</td>}
                  </tr>
                ))}
                {data.unpaid.length === 0 && (
                  <tr>
                    <td colSpan={basic ? 3 : 4} className="py-8 text-center text-ink-soft">
                      {t("Nothing outstanding.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </section>

        <section className="glass-panel neon-edge rounded-card p-5">
          <h2 className="text-base font-semibold text-ink">{t("Active clients by type")}</h2>
          <p className="text-[13px] text-ink-muted">{t("Clients billed for each type in the last 3 months.")}</p>
          <ul className="mt-4 space-y-2.5">
            {data.activeByType.map((row) => {
              const max = data.activeByType[0]?.clients || 1;
              return (
                <li key={row.type}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink">{row.type === "Untyped" ? t("Untyped") : row.type}</span>
                    <span className="tnum text-ink-muted">{row.clients}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-overlay/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${(row.clients / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {data.activeByType.length === 0 && <li className="py-6 text-center text-[13px] text-ink-soft">{t("No invoices in the last 3 months.")}</li>}
          </ul>
        </section>
      </div>

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold text-ink">{t("Clients billed, last 3 months")}</h2>
            <p className="text-[13px] text-ink-muted">{t("A gap means a client was not billed that month.")}</p>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-control border border-overlay/10 bg-overlay/[0.04] px-3 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/25"
          >
            <option value="All">{t("All")}</option>
            {data.activeByType.map((row) => (
              <option key={row.type} value={row.type}>
                {row.type === "Untyped" ? t("Untyped") : row.type}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                <th className="py-2 pr-3">{t("Client")}</th>
                {data.recentMonths.map((m) => (
                  <th key={m} className="py-2 pr-3 text-right">
                    {monthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.clientId} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/clients/${c.clientId}`} className="text-ink hover:text-brand-700 dark:hover:text-brand-200">
                      {c.name}
                    </Link>
                  </td>
                  {data.recentMonths.map((m) => (
                    <td key={m} className={cn("tnum py-2 pr-3 text-right", c.months[m] ? "text-ink" : "text-rose-600 dark:text-rose-300/70")}>
                      {!c.months[m] ? "—" : basic ? <Check className="ml-auto h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-label={t("Billed")} /> : formatMoney(c.months[m])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type UnpaidRows = DashboardData["unpaid"];

/** Excel-style pivot: one row per client, one column per invoice month. */
function UnpaidByMonth({ rows, monthLabel }: { rows: UnpaidRows; monthLabel: (m: string) => string }) {
  const { t } = useI18n();
  const captureRef = useRef<HTMLDivElement>(null);

  if (rows.length === 0) return <p className="py-8 text-center text-[13px] text-ink-soft">{t("Nothing outstanding.")}</p>;

  return (
    <>
      <div className="mt-3 flex items-center justify-end">
        <CopyImageButton target={captureRef} filename={`unpaid-by-month-${new Date().toISOString().slice(0, 10)}`} />
      </div>

      <div className="mt-2 max-h-[560px] overflow-auto">
        <PivotTable rows={rows} monthLabel={monthLabel} interactive />
      </div>

      {/* Uncropped copy used for the image: no scroll box, no sticky cells, no truncation. */}
      <div aria-hidden className="pointer-events-none fixed left-[-100000px] top-0">
        <div ref={captureRef} className="inline-block bg-surface p-5 text-ink">
          <div className="mb-3 flex items-end justify-between gap-8 border-b border-line pb-3">
            <div>
              <div className="text-[15px] font-semibold">{t("Unpaid by client · by invoice month (USD)")}</div>
              <div className="text-[12px] text-ink-soft">{t("As of {0}", formatDate(new Date()))}</div>
            </div>
            <BrandLogo className="h-6" />
          </div>
          <PivotTable rows={rows} monthLabel={monthLabel} />
        </div>
      </div>
    </>
  );
}

function PivotTable({ rows, monthLabel, interactive = false }: { rows: UnpaidRows; monthLabel: (m: string) => string; interactive?: boolean }) {
  const { t } = useI18n();
  const months = Array.from(new Set(rows.flatMap((r) => Object.keys(r.byMonth)))).sort();
  const colTotal = (m: string) => rows.reduce((s, r) => s + (r.byMonth[m] ?? 0), 0);
  const grand = rows.reduce((s, r) => s + r.amount, 0);
  const sticky = interactive ? "sticky left-0 z-[1] bg-surface" : "";
  const stickyHead = interactive ? "z-[3]" : "";

  return (
    <table className="w-full whitespace-nowrap text-[13px]">
      <thead className={cn(interactive && "sticky top-0 z-[2] bg-surface")}>
        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
          <th className={cn(sticky, stickyHead, "py-2 pr-4")}>{t("Client")}</th>
          {months.map((m) => (
            <th key={m} className="px-3 py-2 text-right">
              {monthLabel(m)}
            </th>
          ))}
          <th className="py-2 pl-3 text-right">{t("Total")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.clientId} className="border-b border-line/60">
            <td className={cn(sticky, "py-2 pr-4", interactive && "max-w-[260px] truncate")}>
              {interactive ? (
                <Link href={`/clients/${r.clientId}`} className="text-ink hover:text-brand-700 dark:hover:text-brand-200" title={r.name}>
                  {r.name}
                </Link>
              ) : (
                r.name
              )}
            </td>
            {months.map((m) => (
              <td key={m} className="tnum px-3 py-2 text-right text-ink-muted">
                {r.byMonth[m] ? formatMoney(r.byMonth[m]) : ""}
              </td>
            ))}
            <td className="tnum py-2 pl-3 text-right font-medium text-amber-600 dark:text-amber-300">{formatMoney(r.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot className={cn(interactive && "sticky bottom-0 z-[2] bg-surface")}>
        <tr className="border-t border-line font-semibold text-ink">
          <td className={cn(sticky, stickyHead, "py-2 pr-4")}>{t("Total")}</td>
          {months.map((m) => (
            <td key={m} className="tnum px-3 py-2 text-right">
              {formatMoney(colTotal(m))}
            </td>
          ))}
          <td className="tnum py-2 pl-3 text-right text-amber-600 dark:text-amber-300">{formatMoney(grand)}</td>
        </tr>
      </tfoot>
    </table>
  );
}