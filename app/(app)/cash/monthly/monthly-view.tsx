"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownCircle, ArrowUpCircle, ChevronDown, ChevronLeft, ChevronRight, Landmark, Receipt } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { CopyImageButton } from "@/components/ui/copy-image-button";
import { SortButton, useSort } from "@/components/ui/sortable";
import { ComparisonReport, MonthReport } from "./cash-report";
import { Segmented, Select } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney, formatMonth } from "@/lib/utils";
import type { MonthlyCategory, MonthlyStatement } from "@/lib/cash";

const KIND_TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { INCOME: "success", EXPENSE: "danger", TRANSFER: "neutral", NONE: "warning" };

export type MonthlyViewMode = "month" | "3m";

const href = (month: string, view: MonthlyViewMode) => `/cash/monthly?month=${month}${view === "3m" ? "&view=3m" : ""}`;

export function MonthlyView({
  statement: s,
  recent,
  months,
  initialView,
}: {
  statement: MonthlyStatement;
  recent: MonthlyStatement[];
  months: string[];
  initialView: MonthlyViewMode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const monthRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(initialView);
  const idx = months.indexOf(s.month);
  const newer = idx > 0 ? months[idx - 1] : null;
  const older = idx >= 0 && idx < months.length - 1 ? months[idx + 1] : null;
  const go = (m: string) => router.push(href(m, view));
  const switchView = (v: MonthlyViewMode) => {
    setView(v);
    window.history.replaceState(null, "", href(s.month, v));
  };
  const last = recent[recent.length - 1];
  const range = t("{0} to {1}", formatMonth(`${recent[0].month}-01`), formatMonth(`${last.month}-01`));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!older}
          onClick={() => older && go(older)}
          aria-label={t("Previous month")}
          className="flex h-10 w-10 items-center justify-center rounded-control border border-overlay/10 bg-overlay/[0.04] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="w-44">
          <Select value={s.month} onChange={(e) => go(e.target.value)} aria-label={t("Month")}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(`${m}-01`)}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          disabled={!newer}
          onClick={() => newer && go(newer)}
          aria-label={t("Next month")}
          className="flex h-10 w-10 items-center justify-center rounded-control border border-overlay/10 bg-overlay/[0.04] text-ink-muted hover:text-ink disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="ml-2">
          <Segmented
            value={view}
            options={[
              { value: "month", label: "Month" },
              { value: "3m", label: "Last 3 months" },
            ]}
            onChange={switchView}
          />
        </div>
        <span className="ml-2 text-[13px] text-ink-soft">{view === "month" ? t("{0} lines", s.lineCount) : range}</span>
        {view === "month" ? (
          <CopyImageButton key="month" target={monthRef} filename={`cash-report-${s.month}`} className="ml-auto" />
        ) : (
          <CopyImageButton key="3m" target={compareRef} filename={`cash-report-${recent[0].month}-to-${last.month}`} className="ml-auto" />
        )}
      </div>

      {view === "3m" ? (
        <section className="glass-panel neon-edge rounded-card">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold text-ink">{t("Last 3 months")}</h2>
            <p className="mt-0.5 text-[13px] text-ink-muted">{t("{0} side by side, with the 3-month average and the change on the month before. A positive change means more cash.", range)}</p>
            {last.month !== s.month && (
              <p className="mt-0.5 text-[13px] text-ink-soft">
                {t("{0} is left out until it is complete: its salary is paid on the 10th of the next month.", formatMonth(`${s.month}-01`))}
              </p>
            )}
          </div>
          <div className="px-5 pb-5">
            <ComparisonReport stmts={recent} />
          </div>
          <p className="border-t border-line px-5 py-3 text-[12px] text-ink-soft">
            {s.ratesUpdatedAt ? t("Rates updated {0}", formatDate(s.ratesUpdatedAt)) : t("No rates stored yet.")}{" "}
            {t("Past months are shown at today's rate, so their USD totals move when rates move.")}
          </p>
        </section>
      ) : (
        <MonthBody statement={s} />
      )}

      {/* Report layouts used for the images, kept off screen so they are never cropped. */}
      <div aria-hidden className="pointer-events-none fixed left-[-100000px] top-0">
        <div ref={monthRef} className="inline-block bg-surface p-6 text-ink">
          <MonthReport stmt={s} recent={recent} />
        </div>
        <div ref={compareRef} className="inline-block bg-surface p-6 text-ink">
          <ComparisonReport stmts={recent} framed />
        </div>
      </div>
    </>
  );
}

function MonthBody({ statement: s }: { statement: MonthlyStatement }) {
  const { t } = useI18n();
  const income = s.categories.filter((c) => c.kind === "INCOME");
  const expense = s.categories.filter((c) => c.kind === "EXPENSE").sort((a, b) => a.usd - b.usd);
  const other = s.categories.filter((c) => c.kind === "TRANSFER" || c.kind === "NONE");
  const net = s.income - s.expense;

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Landmark} label="Opening balance" value={formatMoney(s.openingUsd)} footer={<Hint>{t("All accounts at the start of the month (USD)")}</Hint>} />
        <KpiCard icon={ArrowDownCircle} tone="success" label="Income" value={formatMoney(s.income)} footer={<Hint>{t("Money received, net of refunds (USD)")}</Hint>} />
        <KpiCard icon={ArrowUpCircle} tone="danger" label="Expenses" value={formatMoney(s.expense)} footer={<Hint>{t("Money spent, net of refunds (USD)")}</Hint>} />
        <KpiCard
          icon={Landmark}
          tone={net >= 0 ? "success" : "warning"}
          label="Closing balance"
          value={formatMoney(s.closingUsd)}
          footer={<Hint>{t("Income minus expenses: {0}", `${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net))}`)}</Hint>}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Section title="Income" total={s.income} categories={income} />
          <Section title="Expenses" total={s.expense} categories={expense} negate />
          {other.length > 0 && (
            <Section
              title="Transfers and uncategorized"
              hint="Money moved between accounts, currency exchanges and bank movements left out of income and expense. Lines without a category are listed here too."
              total={s.transfers + s.uncategorized}
              categories={other}
            />
          )}
        </div>

        <aside className="space-y-6">
          <section className="glass-panel neon-edge rounded-card">
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold text-ink">{t("Summary (USD)")}</h2>
            </div>
            <dl className="tnum divide-y divide-line/60 px-5 text-sm">
              <Row label="Opening balance" value={s.openingUsd} />
              <Row label="Income" value={s.income} sign="+" />
              <Row label="Expenses" value={s.expense} sign="−" />
              <Row label="Transfers (net)" value={s.transfers} signed />
              {Math.abs(s.uncategorized) >= 0.005 && <Row label="Uncategorized (net)" value={s.uncategorized} signed />}
              {Math.abs(s.timing) >= 0.005 && (
                <Row
                  label="Banked in another month (net)"
                  value={s.timing}
                  signed
                  note={t("Lines whose month used differs from the bank date, e.g. salary paid on the 10th for the month before.")}
                />
              )}
              <Row label="Closing balance" value={s.closingUsd} strong />
            </dl>
          </section>

          <section className="glass-panel neon-edge rounded-card">
            <div className="border-b border-line px-5 py-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <Receipt className="h-4 w-4 text-ink-soft" />
                {t("Invoices this month")}
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">{t("From the invoice ledger, in booked USD.")}</p>
            </div>
            <dl className="tnum divide-y divide-line/60 px-5 text-sm">
              <Row label="Issued" value={s.invoices.issuedUsd} note={t("{0} invoices, excluding waived", s.invoices.issuedCount)} />
              <Row label="Marked paid" value={s.invoices.receivedUsd} note={t("{0} invoices received this month", s.invoices.receivedCount)} />
              <Row label="Unpaid at month end" value={s.invoices.unpaidUsd} note={t("{0} invoices still outstanding", s.invoices.unpaidCount)} />
            </dl>
          </section>

          <p className="px-1 text-[12px] text-ink-soft">
            {s.ratesUpdatedAt ? t("Rates updated {0}", formatDate(s.ratesUpdatedAt)) : t("No rates stored yet.")}{" "}
            {t("Past months are shown at today's rate, so their USD totals move when rates move.")}
          </p>
        </aside>
      </div>
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink-soft">{children}</p>;
}

function Row({ label, value, sign, signed, strong, note }: { label: string; value: number; sign?: string; signed?: boolean; strong?: boolean; note?: string }) {
  const { t } = useI18n();
  const prefix = signed ? (value < 0 ? "−" : "+") : sign ?? "";
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <dt className={cn("text-ink-muted", strong && "font-semibold text-ink")}>
        {t(label)}
        {note && <span className="block text-[12px] text-ink-soft">{note}</span>}
      </dt>
      <dd className={cn("text-right text-ink", strong && "font-semibold")}>
        {prefix}
        {formatMoney(signed ? Math.abs(value) : value)}
      </dd>
    </div>
  );
}

function Section({ title, hint, total, categories, negate }: { title: string; hint?: string; total: number; categories: MonthlyCategory[]; negate?: boolean }) {
  const { t } = useI18n();
  return (
    <section className="glass-panel neon-edge rounded-card">
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{t(title)}</h2>
          {hint && <p className="mt-0.5 max-w-xl text-[13px] text-ink-muted">{t(hint)}</p>}
        </div>
        <p className="tnum text-base font-semibold text-ink">USD {formatMoney(total)}</p>
      </div>
      {categories.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-ink-soft">{t("Nothing this month.")}</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {categories.map((c) => (
            <CategoryRow key={c.id || "none"} category={c} negate={negate} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryRow({ category: c, negate }: { category: MonthlyCategory; negate?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const shown = (n: number) => (Math.abs(n) < 0.005 ? 0 : negate ? -n : n);
  const natives = Object.entries(c.native).filter(([cur, n]) => cur !== "USD" && Math.abs(n) >= 0.005);
  const { sorted, sort, toggle } = useSort(c.lines, {
    date: (l) => l.date,
    account: (l) => l.account,
    purpose: (l) => l.purpose,
    detail: (l) => [l.invoice?.number, l.party, l.memo].filter(Boolean).join(" · "),
    amount: (l) => shown(l.net),
    usd: (l) => shown(l.usd),
  });

  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-overlay/[0.03]">
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-soft transition-transform", !open && "-rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Badge tone={KIND_TONE[c.kind]}>{c.kind === "NONE" ? t("Uncategorized") : c.name}</Badge>
            {c.nameEn && <span className="truncate text-[13px] text-ink-muted">{t(c.nameEn)}</span>}
          </span>
          {natives.length > 0 && (
            <span className="tnum mt-1 block text-[12px] text-ink-soft">
              {natives.map(([cur, n]) => `${cur} ${formatMoney(shown(n))}`).join(" · ")}
            </span>
          )}
        </span>
        <span className="text-[12px] text-ink-soft">{c.lines.length === 1 ? t("1 line") : t("{0} lines", c.lines.length)}</span>
        <span className="tnum w-32 text-right font-medium text-ink">{formatMoney(shown(c.usd))}</span>
      </button>
      {open && (
        <div className="border-t border-line/60 bg-overlay/[0.02] px-5 pb-4 pt-3">
          {c.byPurpose.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {c.byPurpose.map((p) => (
                <span key={p.purpose} className="tnum rounded-full border border-overlay/10 px-2.5 py-0.5 text-[12px] text-ink-muted">
                  {p.purpose} · {formatMoney(shown(p.usd))}
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="tnum w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="py-1.5 pr-3 font-semibold">
                    <SortButton sortKey="date" sort={sort} onSort={toggle}>{t("Date")}</SortButton>
                  </th>
                  <th className="px-3 py-1.5 font-semibold">
                    <SortButton sortKey="account" sort={sort} onSort={toggle}>{t("Account")}</SortButton>
                  </th>
                  <th className="px-3 py-1.5 font-semibold">
                    <SortButton sortKey="purpose" sort={sort} onSort={toggle}>{t("Purpose")}</SortButton>
                  </th>
                  <th className="px-3 py-1.5 font-semibold">
                    <SortButton sortKey="detail" sort={sort} onSort={toggle}>{t("Detail")}</SortButton>
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    <SortButton sortKey="amount" sort={sort} onSort={toggle}>{t("Amount")}</SortButton>
                  </th>
                  <th className="py-1.5 pl-3 text-right font-semibold">
                    <SortButton sortKey="usd" sort={sort} onSort={toggle}>USD</SortButton>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((l) => (
                  <tr key={l.id} className="border-t border-line/50">
                    <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">
                      {formatDate(l.date)}
                      {l.otherMonth && <span className="ml-1.5 text-[11px] text-ink-soft" title={t("Banked in {0}", l.otherMonth)}>↺</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{l.account}</td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-ink" title={l.purpose}>
                      {l.purpose || "—"}
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-ink-muted">
                      <span className="block truncate" title={[l.party, l.memo].filter(Boolean).join(" · ")}>
                        {l.invoice && (
                          <Link href={`/invoices/${l.invoice.id}`} className="mr-1.5 font-mono text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
                            {l.invoice.number}
                          </Link>
                        )}
                        {[l.party, l.memo].filter(Boolean).join(" · ") || (l.invoice ? "" : "—")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-ink">
                      {l.currency !== "USD" && <span className="mr-1 text-[11px] text-ink-soft">{l.currency}</span>}
                      {formatMoney(shown(l.net))}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-3 text-right text-ink-muted">{formatMoney(shown(l.usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </li>
  );
}
