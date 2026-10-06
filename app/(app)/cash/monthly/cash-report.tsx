"use client";

import { BrandLogo } from "@/components/brand/brand-logo";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney, formatMonth } from "@/lib/utils";
import type { MonthlyCategory, MonthlyStatement } from "@/lib/cash";
import { SALARY_CATEGORY, salaryParts } from "@/lib/salary-parts";

type RowKind = "balance" | "section" | "item" | "sub" | "subtotal" | "grand";
type ReportRow = { key: string; label: string; kind: RowKind; values: number[] };

const ZERO = 0.5;

/** Whole dollars, negatives in brackets, nil as a dash. */
export function acct(n: number | null) {
  if (n === null) return "";
  if (Math.abs(n) < ZERO) return "–";
  const s = formatMoney(Math.abs(n), 0);
  return n < 0 ? `(${s})` : s;
}

function categoryRows(
  stmts: MonthlyStatement[],
  kind: MonthlyCategory["kind"],
  label: (c: MonthlyCategory) => string,
  partLabel: (p: { key: string; label: string }) => string
): ReportRow[] {
  const byId = new Map<string, { c: MonthlyCategory; values: number[]; parts: Map<string, { label: string; values: number[] }> }>();
  stmts.forEach((s, i) => {
    for (const c of s.categories) {
      if (c.kind !== kind) continue;
      const row = byId.get(c.id) ?? { c, values: stmts.map(() => 0), parts: new Map() };
      row.values[i] = c.usd;
      if (c.name === SALARY_CATEGORY) {
        for (const p of salaryParts(c.byPurpose)) {
          const part = row.parts.get(p.label) ?? { label: partLabel(p), values: stmts.map(() => 0) };
          part.values[i] = p.usd;
          row.parts.set(p.label, part);
        }
      }
      byId.set(c.id, row);
    }
  });
  const magnitude = (v: number[]) => v.reduce((s, n) => s + Math.abs(n), 0);
  return [...byId.values()]
    .filter((r) => magnitude(r.values) >= ZERO)
    .sort((a, b) => magnitude(b.values) - magnitude(a.values))
    .flatMap((r): ReportRow[] => [
      { key: `${kind}:${r.c.id}`, label: label(r.c), kind: "item", values: r.values },
      ...[...r.parts.entries()]
        .filter(([, p]) => magnitude(p.values) >= ZERO)
        .map(([k, p]): ReportRow => ({ key: `${kind}:${r.c.id}:${k}`, label: p.label, kind: "sub", values: p.values })),
    ]);
}

function useReport(stmts: MonthlyStatement[]) {
  const { t, locale } = useI18n();
  const label = (c: MonthlyCategory) => (locale === "zh-CN" || !c.nameEn ? c.name : c.nameEn);
  const partLabel = (p: { key: string; label: string }) => (p.key && locale === "zh-CN" ? p.key : t(p.label));
  const all = (f: (s: MonthlyStatement) => number) => stmts.map(f);
  const any = (v: number[]) => v.some((n) => Math.abs(n) >= ZERO);

  const transfers = all((s) => s.transfers);
  const uncategorized = all((s) => s.uncategorized);
  const timing = all((s) => s.timing);

  const cash: ReportRow[] = [
    { key: "opening", label: t("Opening cash"), kind: "balance", values: all((s) => s.openingUsd) },
    { key: "income", label: t("Cash received"), kind: "section", values: all((s) => s.income) },
    ...categoryRows(stmts, "INCOME", label, partLabel),
    { key: "expense", label: t("Operating expenses"), kind: "section", values: all((s) => -s.expense) },
    ...categoryRows(stmts, "EXPENSE", label, partLabel),
    { key: "net", label: t("Net operating cash flow"), kind: "subtotal", values: all((s) => s.income - s.expense) },
    ...(any(transfers) ? [{ key: "transfers", label: t("Transfers and FX (net)"), kind: "item" as const, values: transfers }] : []),
    ...(any(uncategorized) ? [{ key: "uncat", label: t("Uncategorized (net)"), kind: "item" as const, values: uncategorized }] : []),
    ...(any(timing) ? [{ key: "timing", label: t("Banked in another month (net)"), kind: "item" as const, values: timing }] : []),
    { key: "closing", label: t("Closing cash"), kind: "grand", values: all((s) => s.closingUsd) },
  ];

  const receivables: ReportRow[] = [
    { key: "issued", label: t("Invoiced"), kind: "item", values: all((s) => s.invoices.issuedUsd) },
    { key: "received", label: t("Collected"), kind: "item", values: all((s) => s.invoices.receivedUsd) },
    { key: "unpaid", label: t("Outstanding at month end"), kind: "balance", values: all((s) => s.invoices.unpaidUsd) },
  ];

  return { cash, receivables };
}

/** Average monthly operating spend over the months that have lines, and the runway it gives the latest closing cash. */
export function burn(stmts: MonthlyStatement[]) {
  const withData = stmts.filter((s) => s.lineCount > 0);
  const avgSpend = withData.length ? withData.reduce((s, m) => s + m.expense, 0) / withData.length : 0;
  const closing = stmts[stmts.length - 1].closingUsd;
  return { avgSpend, months: withData.length, runway: avgSpend > 0 ? closing / avgSpend : null };
}

function ReportHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-8 border-b border-line pb-3">
      <div>
        <div className="text-[16px] font-semibold">{title}</div>
        <div className="text-[12px] text-ink-soft">{subtitle}</div>
      </div>
      <BrandLogo className="h-6" />
    </div>
  );
}

function ReportFooter({ stmt }: { stmt: MonthlyStatement }) {
  const { t } = useI18n();
  return (
    <p className="mt-4 text-[11px] text-ink-soft">
      {t("USD at rates of {0}. Brackets are outflows. Prepared {1}.", stmt.ratesUpdatedAt ? formatDate(stmt.ratesUpdatedAt) : "—", formatDate(new Date()))}
    </p>
  );
}

const ROW_STYLE: Record<RowKind, string> = {
  balance: "font-medium",
  section: "font-semibold",
  item: "text-ink-muted",
  sub: "text-[12px] text-ink-soft",
  subtotal: "font-semibold border-t border-line",
  grand: "font-semibold border-t border-ink/50 border-b-[3px] border-b-ink/50 border-double",
};

function Rows({ rows, extra }: { rows: ReportRow[]; extra?: (r: ReportRow) => React.ReactNode }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.key} className={ROW_STYLE[r.kind]}>
          <td className={cn("py-1 pr-6", r.kind === "item" && "pl-4", r.kind === "sub" && "py-0.5 pl-8")}>{r.label}</td>
          {r.values.map((v, i) => (
            <td key={i} className="py-1 pl-6 text-right">
              {acct(v)}
            </td>
          ))}
          {extra?.(r)}
        </tr>
      ))}
    </>
  );
}

function SectionHead({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {label}
      </td>
    </tr>
  );
}

/** One month, cash-flow statement layout, for copying as an image. */
export function MonthReport({ stmt, recent }: { stmt: MonthlyStatement; recent: MonthlyStatement[] }) {
  const { t } = useI18n();
  const { cash, receivables } = useReport([stmt]);
  const b = burn(recent);
  const net = stmt.income - stmt.expense;
  const tiles = [
    { label: t("Closing cash"), value: acct(stmt.closingUsd) },
    { label: t("Operating cash flow"), value: acct(net), tone: net < 0 ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300" },
    { label: t("Avg spend ({0} mo)", b.months), value: acct(b.avgSpend) },
    { label: t("Runway"), value: b.runway === null ? "—" : t("{0} months", b.runway.toFixed(1)) },
  ];

  return (
    <div className="tnum w-[560px] text-[13px]">
      <ReportHeader title={t("Monthly cash report · {0}", formatMonth(`${stmt.month}-01`))} subtitle={t("All bank accounts, in USD")} />
      <div className="mb-2 grid grid-cols-4 gap-2">
        {tiles.map((x) => (
          <div key={x.label} className="flex flex-col justify-between rounded-md border border-line px-3 py-2">
            <div className="whitespace-nowrap text-[11px] leading-tight text-ink-soft">{x.label}</div>
            <div className={cn("mt-1 text-[15px] font-semibold", x.tone)}>{x.value}</div>
          </div>
        ))}
      </div>
      <table className="w-full">
        <tbody>
          <SectionHead label={t("Cash flow")} cols={2} />
          <Rows rows={cash} />
          <SectionHead label={t("Receivables")} cols={2} />
          <Rows rows={receivables} />
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-ink-soft">{t("Runway is closing cash divided by average monthly operating spend.")}</p>
      <ReportFooter stmt={stmt} />
    </div>
  );
}

/** Months side by side with a 3-month average and the change on the prior month. */
export function ComparisonReport({ stmts, framed = false }: { stmts: MonthlyStatement[]; framed?: boolean }) {
  const { t } = useI18n();
  const { cash, receivables } = useReport(stmts);
  const last = stmts[stmts.length - 1];
  const b = burn(stmts);
  const cols = stmts.length + 3;
  const isBalance = (r: ReportRow) => r.kind === "balance" || r.kind === "grand";
  const extra = (r: ReportRow) => {
    const avg = isBalance(r) ? null : r.values.reduce((s, n) => s + n, 0) / r.values.length;
    const change = r.values.length > 1 ? r.values[r.values.length - 1] - r.values[r.values.length - 2] : null;
    return (
      <>
        <td className="border-l border-line/60 py-1 pl-6 text-right">{acct(avg)}</td>
        <td className="py-1 pl-6 text-right">{acct(change)}</td>
      </>
    );
  };

  const table = (
    <table className="w-full whitespace-nowrap">
      <thead>
        <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-soft">
          <th className="py-1.5 pr-6 text-left font-semibold">USD</th>
          {stmts.map((s) => (
            <th key={s.month} className="py-1.5 pl-6 text-right font-semibold">
              {formatMonth(`${s.month}-01`)}
            </th>
          ))}
          <th className="border-l border-line/60 py-1.5 pl-6 text-right font-semibold">{t("{0}-mo avg", stmts.length)}</th>
          <th className="py-1.5 pl-6 text-right font-semibold">{t("Change")}</th>
        </tr>
      </thead>
      <tbody>
        <SectionHead label={t("Cash flow")} cols={cols} />
        <Rows rows={cash} extra={extra} />
        <SectionHead label={t("Receivables")} cols={cols} />
        <Rows rows={receivables} extra={extra} />
      </tbody>
    </table>
  );

  if (!framed) return <div className="tnum overflow-x-auto text-[13px]">{table}</div>;

  return (
    <div className="tnum text-[13px]">
      <ReportHeader
        title={t("Cash report · {0} – {1}", formatMonth(`${stmts[0].month}-01`), formatMonth(`${last.month}-01`))}
        subtitle={t("All bank accounts, in USD. Change is {0} against the month before; positive means more cash.", formatMonth(`${last.month}-01`))}
      />
      {table}
      <p className="mt-3 text-[11px] text-ink-soft">
        {b.runway === null
          ? t("No operating spend in these months.")
          : t("Runway {0} months: closing cash divided by average monthly operating spend of {1}.", b.runway.toFixed(1), acct(b.avgSpend))}
      </p>
      <ReportFooter stmt={last} />
    </div>
  );
}
