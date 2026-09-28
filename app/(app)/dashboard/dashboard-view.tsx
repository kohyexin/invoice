"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, CheckCircle2, Hourglass, Receipt, Trophy, Users, XCircle } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useChartTheme } from "@/components/dashboard/use-chart-theme";
import { Segmented } from "@/components/ui/form-controls";
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
  unpaid: { clientId: string; name: string; amount: number; count: number; oldest: string }[];
  activeByType: { type: string; clients: number }[];
  recentMonths: string[];
  recentClients: { clientId: string; name: string; byType: Record<string, Record<string, number>> }[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string, withYear = true) => `${MONTHS[Number(m.slice(5, 7)) - 1]}${withYear ? ` ${m.slice(0, 4)}` : ""}`;

const RANGES = [
  { value: "12", label: "12 months" },
  { value: "24", label: "24 months" },
  { value: "all", label: "All" },
] as const;

export function DashboardView({ data }: { data: DashboardData }) {
  const chart = useChartTheme();
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("12");
  const [typeFilter, setTypeFilter] = useState("All");
  const { totals } = data;

  const series = useMemo(() => {
    const all = data.monthly;
    const cut = range === "all" ? all : all.slice(-Number(range));
    return cut.map((m) => ({ ...m, label: monthLabel(m.month).replace(/ 20(\d\d)/, " '$1") }));
  }, [data.monthly, range]);

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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Receipt} label="Total invoiced" value={formatMoney(totals.all.amount, 0)} footer={hint(`${totals.all.count} invoices issued`)} />
        <KpiCard icon={CheckCircle2} tone="success" label="Paid" value={formatMoney(totals.paid.amount, 0)} footer={hint(`${totals.paid.count} invoices`)} />
        <KpiCard icon={Hourglass} tone="warning" label="Unpaid" value={formatMoney(totals.unpaid.amount, 0)} footer={hint(`${totals.unpaid.count} invoices sent, not paid`)} />
        <KpiCard
          icon={XCircle}
          tone="danger"
          label="End / lost"
          value={formatMoney(totals.endLost.amount, 0)}
          footer={hint(`${totals.endLost.count} invoices · ${totals.waived.count} waived (${formatMoney(totals.waived.amount, 0)})`)}
        />
        <KpiCard icon={Users} label="Clients" value={String(data.clientCount)} footer={hint(`${data.activeClients} billed in the last 3 months`)} />
        <KpiCard
          icon={CalendarDays}
          label={`This month · ${monthLabel(data.thisMonth.month)}`}
          value={formatMoney(data.thisMonth.billed, 0)}
          footer={hint(`${data.thisMonth.count} invoices · ${formatMoney(data.thisMonth.received, 0)} received`)}
        />
        <KpiCard
          icon={Trophy}
          tone="success"
          label="Best month"
          value={data.best ? formatMoney(data.best.billed, 0) : "—"}
          footer={hint(data.best ? `${monthLabel(data.best.month)} · ${data.best.count} invoices` : "No history yet")}
        />
        <KpiCard icon={BarChart3} label="Median month" value={formatMoney(data.medianMonth, 0)} footer={hint("Across completed months")} />
      </div>

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold text-ink">Invoiced and received per month</h2>
            <p className="text-[13px] text-ink-muted">Bars by invoice date, line by received date.</p>
          </div>
          <Segmented value={range} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} onChange={setRange} />
        </div>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis stroke={chart.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompact(Number(v))} width={52} />
              <Tooltip
                cursor={{ fill: "rgba(84,112,214,0.08)" }}
                contentStyle={{ background: chart.tooltipBg, border: `1px solid ${chart.tooltipBorder}`, borderRadius: 8, color: chart.tooltipText, fontSize: 12 }}
                formatter={(v: number, name: string) => [formatMoney(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: chart.axis }} />
              <Bar dataKey="billed" name="Invoiced" fill={chart.brand} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line dataKey="received" name="Received" stroke={chart.brandBright} strokeWidth={2} dot={false} style={{ filter: "drop-shadow(0 0 5px rgba(34,211,238,0.6))" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="glass-panel neon-edge rounded-card p-5">
          <h2 className="text-base font-semibold text-ink">Unpaid by client</h2>
          <p className="text-[13px] text-ink-muted">Invoices with status SENT, largest balance first.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3 text-right">Invoices</th>
                  <th className="py-2 pr-3">Oldest</th>
                  <th className="py-2 text-right">Unpaid</th>
                </tr>
              </thead>
              <tbody>
                {data.unpaid.map((u) => (
                  <tr key={u.clientId} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/clients/${u.clientId}`} className="text-ink hover:text-brand-200">
                        {u.name}
                      </Link>
                    </td>
                    <td className="tnum py-2 pr-3 text-right text-ink-muted">{u.count}</td>
                    <td className="py-2 pr-3 text-ink-muted">{formatDate(u.oldest)}</td>
                    <td className="tnum py-2 text-right text-amber-300">{formatMoney(u.amount)}</td>
                  </tr>
                ))}
                {data.unpaid.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-ink-soft">
                      Nothing outstanding.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass-panel neon-edge rounded-card p-5">
          <h2 className="text-base font-semibold text-ink">Active clients by type</h2>
          <p className="text-[13px] text-ink-muted">Clients billed for each type in the last 3 months.</p>
          <ul className="mt-4 space-y-2.5">
            {data.activeByType.map((t) => {
              const max = data.activeByType[0]?.clients || 1;
              return (
                <li key={t.type}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink">{t.type}</span>
                    <span className="tnum text-ink-muted">{t.clients}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-overlay/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400" style={{ width: `${(t.clients / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {data.activeByType.length === 0 && <li className="py-6 text-center text-[13px] text-ink-soft">No invoices in the last 3 months.</li>}
          </ul>
        </section>
      </div>

      <section className="glass-panel neon-edge rounded-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-base font-semibold text-ink">Clients billed, last 3 months</h2>
            <p className="text-[13px] text-ink-muted">A gap means a client was not billed that month.</p>
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-control border border-overlay/10 bg-overlay/[0.04] px-3 text-[13px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/25"
          >
            <option>All</option>
            {data.activeByType.map((t) => (
              <option key={t.type}>{t.type}</option>
            ))}
          </select>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                <th className="py-2 pr-3">Client</th>
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
                    <Link href={`/clients/${c.clientId}`} className="text-ink hover:text-brand-200">
                      {c.name}
                    </Link>
                  </td>
                  {data.recentMonths.map((m) => (
                    <td key={m} className={cn("tnum py-2 pr-3 text-right", c.months[m] ? "text-ink" : "text-rose-300/70")}>
                      {c.months[m] ? formatMoney(c.months[m]) : "—"}
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
