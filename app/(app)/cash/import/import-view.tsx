"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, CheckCheck, CheckCircle2, ChevronDown, FileUp, Inbox, Plus, RotateCcw, Split, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, fieldClass } from "@/components/ui/form-controls";
import { SortButton, useSort, type SortAccessors } from "@/components/ui/sortable";
import { useCan } from "@/components/shell/user-context";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney, formatMonth, round2 } from "@/lib/utils";
import type { MonthPreview, StatementPreview } from "@/lib/statements/reconcile";
import type { LineEdits } from "@/lib/statements/queue";
import type { SplitRow } from "@/lib/statements/types";
import {
  approveStatementLine,
  copyAccountDetails,
  finishStatementApprovals,
  rejectStatementLine,
  restoreStatementLine,
  saveStatementLine,
  uploadStatements,
  type UploadChoices,
} from "./actions";

const card = "glass-panel neon-edge rounded-card";
type Category = { id: string; nameZh: string; nameEn: string; kind: string };
export type QueueLine = {
  id: string;
  kind: "opening" | "interest" | "entry";
  date: string;
  /** yyyy-mm */
  period: string;
  amountIn: number;
  amountOut: number;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  description: string;
  counterparty: string;
  suggested: string;
  clientId: string;
  invoiceIds: string[];
  splits: SplitRow[] | null;
  status: string;
  accountId: string;
  account: string;
  currency: string;
  decidedAt: string;
  decidedBy: string | null;
};
export type PaymentOptions = {
  clients: { id: string; name: string }[];
  /** Unpaid invoices, one per number; `ids` are the rows of that number. */
  invoices: { number: string; ids: string[]; clientId: string; currency: string; invoiceDate: string; due: number }[];
  /** Credit balance keyed by `clientId|currency`. */
  credits: Record<string, number>;
};
export type StatementCheck = {
  id: string;
  file: string;
  account: string;
  accountId: string;
  currency: string;
  periodStart: string;
  bankClosing: number;
  bookClosing: number;
  afterApproval: number;
  offStatement: number;
  uploadedAt: string;
};
type Progress = { label: string; done: number; total: number };

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** The month used for a new date, keeping its distance from the old date (salary stays a month back). */
function shiftMonth(date: string, oldDate: string, oldPeriod: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}$/.test(oldPeriod)) return oldPeriod;
  const months = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
  const m = months(date) - (months(oldDate) - months(oldPeriod));
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
}

const editsOf = (l: QueueLine): LineEdits => ({
  date: l.date,
  period: l.period,
  categoryId: l.categoryId,
  purpose: l.purpose,
  party: l.party,
  memo: l.memo,
  clientId: l.clientId,
  invoiceIds: l.invoiceIds,
  splits: l.splits,
});
const sameEdits = (a: LineEdits, b: LineEdits) => JSON.stringify(a) === JSON.stringify(b);
const netOf = (r: { amountIn: number; amountOut: number }) => round2(r.amountIn - r.amountOut);
const leftToSplit = (l: QueueLine, rows: SplitRow[]) => round2(netOf(l) - rows.reduce((t, r) => t + netOf(r), 0));

/** What paying the ticked invoices from this receipt does, as Record payment would. */
function paymentPlan(l: QueueLine, v: LineEdits, payment: PaymentOptions) {
  const ids = v.invoiceIds ?? [];
  const picked = payment.invoices.filter((i) => i.currency === l.currency && i.ids.some((id) => ids.includes(id)));
  const due = round2(picked.reduce((t, i) => t + i.due, 0));
  const credit = Math.max(payment.credits[`${v.clientId}|${l.currency}`] ?? 0, 0);
  const fromCredit = round2(Math.max(due - l.amountIn, 0));
  return {
    picked,
    due,
    credit,
    fromCredit,
    leftOver: round2(Math.max(l.amountIn - due, 0)),
    short: round2(Math.max(fromCredit - credit, 0)),
    gone: ids.length > picked.reduce((t, i) => t + i.ids.length, 0),
  };
}

/** Why the line can't be approved yet, or null. */
function blocker(l: QueueLine, v: LineEdits, payment: PaymentOptions): string | null {
  if (v.splits?.length) {
    if (v.splits.some((r) => !r.categoryId)) return "Pick a category on every split row.";
    if (!same(leftToSplit(l, v.splits), 0)) return "Split rows must add up to the bank amount.";
    return null;
  }
  if (!v.categoryId) return "Pick a category to approve.";
  if (v.clientId && v.invoiceIds?.length) {
    const plan = paymentPlan(l, v, payment);
    if (plan.gone) return "A ticked invoice is no longer unpaid.";
    if (plan.short > 0) return "The receipt and the client's credit don't cover the ticked invoices.";
  }
  return null;
}

export function StatementImportView({
  payment,
  categories,
  pending,
  rejected,
  recent,
  statements,
}: {
  payment: PaymentOptions;
  categories: Category[];
  pending: QueueLine[];
  rejected: QueueLine[];
  recent: QueueLine[];
  statements: StatementCheck[];
}) {
  return (
    <div className="space-y-6">
      <Uploader />
      <ApprovalQueue lines={pending} categories={categories} payment={payment} />
      <Statements rows={statements} />
      <RejectedList rows={rejected} />
      <RecentList rows={recent} />
    </div>
  );
}

function Uploader() {
  const { t } = useI18n();
  const router = useRouter();
  const canEdit = useCan("statementImport", "EDIT");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<(StatementPreview & { queued: number }) | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function formFor(list: File[], choices: UploadChoices) {
    const form = new FormData();
    list.forEach((f) => form.append("files", f));
    form.append("choices", JSON.stringify(choices));
    return form;
  }

  function upload(list: File[], accountChoices: Record<string, string>) {
    setError(null);
    setCopied(null);
    start(async () => {
      const res = await uploadStatements(formFor(list, { accounts: accountChoices }));
      if (!res.ok) {
        setResult(null);
        return setError(res.error);
      }
      setResult(res);
      setDetails(Object.fromEntries(res.accounts.map((a) => [a.accountId, new Set(a.fields.filter((f) => f.tick).map((f) => f.key))])));
      router.refresh();
    });
  }

  function choose(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((f) => /\.(pdf|xlsx?|csv)$/i.test(f.name) || f.type === "application/pdf");
    if (!picked.length) return;
    setFiles(picked);
    setAccounts({});
    upload(picked, {});
  }

  function pickAccount(month: MonthPreview, accountId: string) {
    const next = { ...accounts, [`${month.accountNumber}:${month.currency}`]: accountId };
    setAccounts(next);
    upload(files, next);
  }

  function copyDetails() {
    const choices: UploadChoices = { accounts, details: Object.fromEntries(Object.entries(details).map(([k, v]) => [k, Array.from(v)])) };
    start(async () => {
      const res = await copyAccountDetails(formFor(files, choices));
      if (!res.ok) return setError(res.error);
      setCopied(t("Settings updated."));
      upload(files, accounts);
    });
  }

  const changedAccounts = result?.accounts.filter((a) => a.fields.some((f) => f.tick)) ?? [];
  const anyTicked = Object.values(details).some((s) => s.size > 0);

  return (
    <>
      <section className={cn(card, "p-5")}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || !canEdit}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files);
          }}
          className={cn(
            "flex min-h-[132px] w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed px-4 text-center transition-colors",
            dragging ? "border-brand-400 bg-brand-500/[0.08]" : "border-overlay/20 hover:border-brand-400/60 hover:bg-brand-500/[0.05]",
          )}
        >
          <FileUp className="h-6 w-6 text-brand-600 dark:text-brand-300" />
          <span className="text-sm font-medium text-ink">{busy ? t("Reading statements…") : t("Drop bank statements")}</span>
          <span className="text-[12px] text-ink-soft">
            {t("ANEXT PDFs, Industrial Bank (XMXY) Excel downloads or Airwallex CSV reports. Date ranges can overlap; lines already imported are skipped.")}
          </span>
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf,.xls,.xlsx,.csv,text/csv" multiple className="hidden" onChange={(e) => choose(e.target.files)} />
      </section>

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}

      {result && (
        <>
          {result.errors.map((e) => (
            <p key={e.file} className="rounded-control border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-200">
              <span className="font-medium">{e.file}:</span> {t(e.message)}
            </p>
          ))}

          {result.months.length > 0 && (
            <p className="flex items-center gap-2 rounded-control border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              {result.queued === 1
                ? t("1 new line is waiting for approval below.")
                : result.queued
                  ? t("{0} new lines are waiting for approval below.", result.queued)
                  : t("Nothing new to queue; everything on these statements is already in the cash book, waiting or rejected.")}
            </p>
          )}

          {changedAccounts.map((a) => (
            <section key={a.accountId} className={card}>
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-base font-semibold text-ink">{t("Account details · {0}", a.label)}</h2>
                <p className="mt-0.5 text-[13px] text-ink-muted">{t("The statement shows different account details from Settings. Tick the ones to copy.")}</p>
              </div>
              <ul className="divide-y divide-line/60 px-5 text-sm">
                {a.fields.map((f) => {
                  const on = details[a.accountId]?.has(f.key) ?? false;
                  return (
                    <li key={f.key} className="flex items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setDetails((d) => {
                            const s = new Set(d[a.accountId] ?? []);
                            if (s.has(f.key)) s.delete(f.key);
                            else s.add(f.key);
                            return { ...d, [a.accountId]: s };
                          })
                        }
                        className="h-4 w-4 accent-brand-600"
                      />
                      <span className="w-40 shrink-0 text-ink-muted">{t(f.label)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{f.statement}</span>
                      <span className="hidden text-[12px] text-ink-soft sm:block">
                        {f.tick ? t("Settings: {0}", f.current || "—") : t("Same as Settings")}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
                {copied && <span className="text-[13px] text-emerald-700 dark:text-emerald-300">{copied}</span>}
                <Button size="sm" variant="secondary" onClick={copyDetails} loading={busy} disabled={!anyTicked}>
                  {t("Copy ticked to Settings")}
                </Button>
              </div>
            </section>
          ))}

          {result.months.map((m) => (
            <MonthResult key={m.id} month={m} candidates={result.candidates[m.currency] ?? []} onAccount={(id) => pickAccount(m, id)} />
          ))}
        </>
      )}
    </>
  );
}

function MonthResult({ month: m, candidates, onAccount }: { month: MonthPreview; candidates: { id: string; label: string }[]; onAccount: (id: string) => void }) {
  const { t } = useI18n();
  const [showMatched, setShowMatched] = useState(false);
  const linked = !!m.accountId;
  const ok = same(m.closingAfterApproval, m.closing);
  const waitingHere = m.waiting + m.proposed.length;

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {formatMonth(m.periodStart)}
            {m.partial && <span className="font-normal text-ink-muted"> ({t("days {0}–{1}", Number(m.periodStart.slice(8)), Number(m.periodEnd.slice(8)))})</span>}
            {" · "}
            {m.accountLabel || `${m.bank} ${m.accountNumber} · ${m.currency}`}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">{m.file}</p>
        </div>
        {linked &&
          (ok ? (
            <Badge tone="success">{waitingHere ? t("Matches the bank once approved") : t("Matches the bank")}</Badge>
          ) : (
            <Badge tone="warning">{t("Differs by {0}", formatMoney(m.closingAfterApproval - m.closing))}</Badge>
          ))}
      </div>

      <div className="space-y-3 px-5 py-4 text-[13px]">
        {!linked && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-ink-muted">{t("Account {0} isn't linked in Settings yet. Which account is it?", m.accountNumber)}</span>
            <Select value="" onChange={(e) => e.target.value && onAccount(e.target.value)} className="max-w-xs">
              <option value="">{t("Pick an account")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
        )}

        {linked && (
          <p className="tnum flex flex-wrap gap-x-5 gap-y-1 text-ink-muted">
            <span>
              {t("Bank closing")} <span className="font-medium text-ink">{m.currency} {formatMoney(m.closing)}</span>
            </span>
            <span>
              {t("Book now")} <span className="font-medium text-ink">{formatMoney(m.baseClosing)}</span>
            </span>
            {waitingHere > 0 && (
              <span>
                {t("Book once approved")} <span className="font-medium text-ink">{formatMoney(m.closingAfterApproval)}</span>
              </span>
            )}
            {m.offStatement !== 0 && <span className="text-ink-soft">{t("Excludes {0} held outside the statement", formatMoney(m.offStatement))}</span>}
          </p>
        )}

        {linked && (
          <ul className="flex flex-wrap gap-2">
            {m.proposed.length > 0 && <Badge tone="warning">{t("{0} new, waiting for approval", m.proposed.length)}</Badge>}
            {m.waiting > 0 && <Badge tone="outline">{t("{0} already waiting", m.waiting)}</Badge>}
            {m.rejected > 0 && <Badge tone="outline">{t("{0} rejected before", m.rejected)}</Badge>}
            {m.caughtUp.length > 0 && <Badge tone="success">{t("{0} now in Excel", m.caughtUp.length)}</Badge>}
            {m.interestAlready && <Badge tone="outline">{t("Interest already imported")}</Badge>}
          </ul>
        )}

        {m.openingWarning !== null && (
          <Warning>{t("The book's opening differs from the bank's by {0}. Check the previous month.", formatMoney(-m.openingWarning))}</Warning>
        )}

        {m.bookOnly.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("Not on the bank statement")}
            </h3>
            <ul className="space-y-1">
              {m.bookOnly.map((b) => (
                <li key={b.id} className="tnum flex flex-wrap gap-x-3">
                  <span className="text-ink-muted">{formatDate(b.date)}</span>
                  <span className="text-ink">{[b.purpose, b.party].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="ml-auto">{formatMoney(b.net)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[12px] text-ink-soft">{t("In the cash book for this month but not on the statement: check the amount, date or account in Excel. Nothing is changed.")}</p>
          </div>
        )}

        {m.matched.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowMatched((s) => !s)} className="flex items-center gap-1.5 text-ink-muted hover:text-ink">
              <ChevronDown className={cn("h-4 w-4 transition-transform", !showMatched && "-rotate-90")} />
              {t("{0} entries already in the cash book", m.matched.length)}
            </button>
            {showMatched && (
              <ul className="mt-2 space-y-1">
                {m.matched.map((x, i) => (
                  <li key={i} className="tnum flex flex-wrap gap-x-3">
                    <span className="text-ink-muted">{formatDate(x.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={x.description}>
                      {x.description}
                    </span>
                    {x.bookDate !== x.date && <span className="text-[12px] text-ink-soft">{t("booked {0}", formatDate(x.bookDate))}</span>}
                    {x.bookSplits && <span className="text-[12px] text-ink-soft">{t("split into {0} lines in the cash book", x.bookSplits.length)}</span>}
                    <span>{formatMoney(x.net)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function KindBadge({ kind }: { kind: QueueLine["kind"] }) {
  const { t } = useI18n();
  if (kind === "entry") return <Badge tone="warning">{t("Missing in Excel")}</Badge>;
  if (kind === "interest") return <Badge tone="outline">{t("Interest")}</Badge>;
  return <Badge tone="outline">{t("Opening adjustment")}</Badge>;
}

function Amount({ line: l }: { line: Pick<QueueLine, "amountIn" | "amountOut" | "currency"> }) {
  return (
    <span className={cn("tnum whitespace-nowrap", l.amountIn ? "text-emerald-700 dark:text-emerald-300" : "text-ink")}>
      <span className="mr-1 text-[11px] text-ink-soft">{l.currency}</span>
      {l.amountIn ? "+" : "−"}
      {formatMoney(l.amountIn || l.amountOut)}
    </span>
  );
}

function ApprovalQueue({ lines, categories, payment }: { lines: QueueLine[]; categories: Category[]; payment: PaymentOptions }) {
  const { t } = useI18n();
  const router = useRouter();
  const canEdit = useCan("statementImport", "EDIT");
  const [edits, setEdits] = useState<Record<string, LineEdits>>({});
  const [bulk, setBulk] = useState<Progress | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const stopRef = useRef(false);
  const visible = lines.filter((l) => !done.has(l.id));
  const editOf = (l: QueueLine) => edits[l.id] ?? editsOf(l);
  const ready = visible.filter((l) => !blocker(l, editOf(l), payment));

  async function approveAll() {
    stopRef.current = false;
    setBulkErrors([]);
    const errors: string[] = [];
    for (let i = 0; i < ready.length; i++) {
      if (stopRef.current) break;
      const l = ready[i];
      setBulk({ label: t("Approving {0} of {1}…", i + 1, ready.length), done: i, total: ready.length });
      const res = await approveStatementLine(l.id, editOf(l), false);
      if (res.ok) setDone((s) => new Set(s).add(l.id));
      else errors.push(`${formatDate(l.date)} ${l.purpose}: ${t(res.error)}`);
    }
    await finishStatementApprovals();
    setBulk(null);
    setBulkErrors(errors);
    router.refresh();
  }

  return (
    <section className={cn(card, "p-5")}>
      <datalist id={CLIENT_LIST}>
        {payment.clients.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-2">
        <Inbox className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <h2 className="text-base font-semibold text-ink">{t("Waiting for approval")}</h2>
        <span className="rounded-full bg-overlay/[0.06] px-2 text-[12px] text-ink-muted">{visible.length}</span>
        {canEdit && ready.length > 1 && (
          <Button size="sm" className="ml-auto" onClick={approveAll} loading={bulk !== null}>
            <CheckCheck className="h-4 w-4" />
            {t("Approve all ready ({0})", ready.length)}
          </Button>
        )}
      </div>
      <p className="text-[13px] text-ink-muted">
        {t("Nothing reaches the cash book until you approve it. Lines marked Missing in Excel are on the bank statement but not in your workbook; add them to Excel too while you run both.")}
      </p>
      {bulk && <ProgressBar progress={bulk} onStop={() => (stopRef.current = true)} />}
      {bulkErrors.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-200">
          {bulkErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        {visible.map((l) => (
          <PendingRow
            key={l.id}
            line={l}
            value={editOf(l)}
            onChange={(v) => setEdits((e) => ({ ...e, [l.id]: v }))}
            categories={categories}
            payment={payment}
            disabled={bulk !== null || !canEdit}
          />
        ))}
        {visible.length === 0 && <p className="py-6 text-center text-[13px] text-ink-soft">{t("Nothing waiting.")}</p>}
      </div>
    </section>
  );
}

function PendingRow({
  line: l,
  value: v,
  onChange,
  categories,
  payment,
  disabled,
}: {
  line: QueueLine;
  value: LineEdits;
  onChange: (v: LineEdits) => void;
  categories: Category[];
  payment: PaymentOptions;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, start] = useTransition();
  const original = editsOf(l);
  const dirty = !sameEdits(original, v);
  const splits = v.splits?.length ? v.splits : null;
  const problem = blocker(l, v, payment);
  const set = (patch: Partial<LineEdits>) => {
    setSaved(false);
    onChange({ ...v, ...patch });
  };
  const startSplit = () =>
    set({
      clientId: "",
      invoiceIds: [],
      splits: [
        { categoryId: v.categoryId, purpose: v.purpose, party: v.party, memo: v.memo, amountIn: l.amountIn, amountOut: l.amountOut },
        { categoryId: "", purpose: "", party: "", memo: v.memo, amountIn: 0, amountOut: 0 },
      ],
    });
  const setSplits = (rows: SplitRow[]) => {
    const lead = rows[0];
    const main = lead ? { categoryId: lead.categoryId, purpose: lead.purpose, party: lead.party, memo: lead.memo } : {};
    set({ ...main, splits: rows.length > 1 ? rows : null });
  };
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      after?.();
      router.refresh();
    });

  return (
    <div className="rounded-card border border-line/70 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <KindBadge kind={l.kind} />
        <span className="text-sm font-medium text-ink">{l.account}</span>
        <span className="ml-auto text-sm">
          <Amount line={l} />
        </span>
      </div>
      {l.description && (
        <p className="mt-1 truncate text-[12px] text-ink-soft" title={l.description}>
          {t("Bank: {0}", l.description)}
        </p>
      )}
      <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-[140px_130px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Date")}</span>
          <input
            type="date"
            value={v.date}
            onChange={(e) => set({ date: e.target.value, period: shiftMonth(e.target.value, v.date, v.period) })}
            disabled={disabled}
            className={cn(fieldClass, "h-9")}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Month used")}</span>
          <input type="month" value={v.period} onChange={(e) => set({ period: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
          {v.period !== v.date.slice(0, 7) && <span className="block text-[11px] text-ink-soft">{t("Not the month of the date")}</span>}
        </label>
        {!splits && (
          <>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Category")}</span>
          <Select value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })} disabled={disabled} className="h-9">
            <option value="">{t("Uncategorized")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn ? `${c.nameZh} · ${c.nameEn}` : c.nameZh}
              </option>
            ))}
          </Select>
          {l.suggested === "history" && <span className="block text-[11px] text-ink-soft">{t("Suggested from earlier lines")}</span>}
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Purpose")}</span>
          <input value={v.purpose} onChange={(e) => set({ purpose: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Party")}</span>
          <input value={v.party} onChange={(e) => set({ party: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
          {l.suggested === "invoice" && <span className="block text-[11px] text-ink-soft">{t("Unpaid invoice for the same amount")}</span>}
        </label>
        <label className="space-y-1 sm:col-span-2 lg:col-span-5">
          <span className="text-[11px] uppercase tracking-wider text-ink-soft">{t("Memo")}</span>
          <input value={v.memo} onChange={(e) => set({ memo: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
        </label>
          </>
        )}
      </div>
      {splits && <SplitEditor line={l} rows={splits} onChange={setSplits} categories={categories} remembered={!!l.splits} disabled={disabled} />}
      {!splits && l.kind === "entry" && l.amountIn > 0 && <InvoicePicker line={l} value={v} payment={payment} onChange={set} disabled={disabled} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={disabled || !!problem} loading={busy} onClick={() => run(() => approveStatementLine(l.id, v))}>
          {t("Approve")}
        </Button>
        {!splits && l.kind === "entry" && (
          <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={startSplit}>
            <Split className="h-3.5 w-3.5" />
            {t("Split")}
          </Button>
        )}
        {dirty && (
          <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => run(() => saveStatementLine(l.id, v), () => setSaved(true))}>
            {t("Save changes")}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => run(() => rejectStatementLine(l.id))}>
          {t("Reject")}
        </Button>
        {problem && <span className="text-[12px] text-amber-700 dark:text-amber-300">{t(problem)}</span>}
        {saved && !dirty && <span className="text-[12px] text-emerald-700 dark:text-emerald-300">{t("Saved.")}</span>}
        {error && <span className="text-[12px] text-rose-600 dark:text-rose-300">{t(error)}</span>}
      </div>
    </div>
  );
}

const label = "text-[11px] uppercase tracking-wider text-ink-soft";

function InvoicePicker({
  line: l,
  value: v,
  payment,
  onChange,
  disabled,
}: {
  line: QueueLine;
  value: LineEdits;
  payment: PaymentOptions;
  onChange: (patch: Partial<LineEdits>) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const ids = v.invoiceIds ?? [];
  const clientId = v.clientId ?? "";
  const options = payment.invoices.filter((i) => i.clientId === clientId && i.currency === l.currency);
  const plan = paymentPlan(l, v, payment);
  const numbers = (list: { number: string }[]) => list.map((i) => i.number).join(", ");
  const partyFor = (picked: typeof options) => (picked.length ? numbers(picked) : v.party === numbers(plan.picked) ? "" : v.party);
  const money = (n: number) => `${l.currency} ${formatMoney(n)}`;

  function pickClient(id: string) {
    onChange({ clientId: id, invoiceIds: [], party: partyFor([]) });
  }
  function toggle(inv: (typeof options)[number]) {
    const on = inv.ids.some((id) => ids.includes(id));
    const next = on ? ids.filter((id) => !inv.ids.includes(id)) : [...ids, ...inv.ids];
    onChange({ invoiceIds: next, party: partyFor(options.filter((o) => o.ids.some((id) => next.includes(id)))) });
  }

  return (
    <div className="mt-3 space-y-2 rounded-control border border-line/60 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className={label}>{t("Client")}</span>
        <ClientSearch clients={payment.clients} value={clientId} onPick={pickClient} disabled={disabled} />
        {clientId && plan.credit > 0 && <span className="tnum text-ink-muted">{t("Credit {0}", money(plan.credit))}</span>}
      </div>

      {!clientId && ids.length > 0 && <p className="text-ink-muted">{t("Settles invoices of several clients by exact amount: {0}", v.party)}</p>}

      {clientId && options.length > 0 && (
        <ul className="max-h-44 space-y-0.5 overflow-auto">
          {options.map((i) => {
            const on = i.ids.some((id) => ids.includes(id));
            return (
              <li key={i.number}>
                <label className="tnum flex cursor-pointer items-center gap-3 rounded px-1 py-1 hover:bg-overlay/[0.04]">
                  <input type="checkbox" checked={on} onChange={() => toggle(i)} disabled={disabled} className="h-4 w-4 accent-brand-600" />
                  <span className="text-ink">{i.number}</span>
                  <span className="text-ink-soft">{formatDate(i.invoiceDate)}</span>
                  <span className="ml-auto text-ink">{formatMoney(i.due)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {clientId && options.length === 0 && <p className="text-ink-soft">{t("No unpaid {0} invoices for this client.", l.currency)}</p>}

      {clientId && ids.length === 0 && <p className="text-ink-muted">{t("No invoices ticked: the whole {0} becomes client credit.", money(l.amountIn))}</p>}
      {clientId && ids.length > 0 && (
        <p className="tnum text-ink-muted">
          {[
            t("Pays {0}", money(plan.due)),
            plan.fromCredit > 0 && t("uses credit {0}", money(plan.fromCredit)),
            plan.leftOver > 0 && t("adds credit {0}", money(plan.leftOver)),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {plan.short > 0 && (
        <p className="text-amber-700 dark:text-amber-300">{t("Short by {0}: the client has {1} credit.", money(plan.short), money(plan.credit))}</p>
      )}
    </div>
  );
}

/** One list of clients for every card's search box (rendered once by the approval queue). */
const CLIENT_LIST = "import-clients";

/** Type a client's name or alias; picking a suggestion sets the client, clearing the box removes it. */
function ClientSearch({
  clients,
  value,
  onPick,
  disabled,
}: {
  clients: PaymentOptions["clients"];
  value: string;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const current = clients.find((c) => c.id === value)?.name ?? "";
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);

  return (
    <input
      list={CLIENT_LIST}
      value={text}
      disabled={disabled}
      placeholder={t("Search client name or alias")}
      onChange={(e) => {
        const typed = e.target.value;
        setText(typed);
        const hit = clients.find((c) => c.name.toLowerCase() === typed.trim().toLowerCase());
        if (hit) onPick(hit.id);
        else if (!typed.trim()) onPick("");
      }}
      onBlur={() => setText(current)}
      className={cn(fieldClass, "h-9 w-full max-w-sm")}
    />
  );
}

function SplitEditor({
  line: l,
  rows,
  onChange,
  categories,
  remembered,
  disabled,
}: {
  line: QueueLine;
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  categories: Category[];
  remembered: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const bankDir = netOf(l) >= 0 ? "in" : "out";
  const [dirs, setDirs] = useState<("in" | "out")[]>(() => rows.map((r) => (r.amountIn > 0 ? "in" : r.amountOut > 0 ? "out" : bankDir)));
  const dirAt = (i: number) => (rows[i].amountIn > 0 ? "in" : rows[i].amountOut > 0 ? "out" : (dirs[i] ?? bankDir));
  const left = leftToSplit(l, rows);
  const withAmount = (r: SplitRow, dir: "in" | "out", amount: number): SplitRow => ({ ...r, amountIn: dir === "in" ? amount : 0, amountOut: dir === "out" ? amount : 0 });

  /** The first row takes whatever the other rows leave of the bank amount. */
  function balanced(next: SplitRow[]) {
    const rest = round2(netOf(l) - next.slice(1).reduce((t, r) => t + netOf(r), 0));
    return [withAmount(next[0], rest >= 0 ? "in" : "out", Math.abs(rest)), ...next.slice(1)];
  }
  function update(i: number, patch: Partial<SplitRow>, rebalance = false) {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(rebalance && i > 0 ? balanced(next) : next);
  }
  function setDir(i: number, dir: "in" | "out") {
    setDirs((d) => Object.assign([...d], { [i]: dir }));
    update(i, withAmount(rows[i], dir, rows[i].amountIn || rows[i].amountOut), true);
  }
  function add() {
    setDirs((d) => [...d, bankDir]);
    onChange([...rows, { categoryId: "", purpose: "", party: "", memo: rows[0]?.memo ?? "", amountIn: 0, amountOut: 0 }]);
  }
  function remove(i: number) {
    setDirs((d) => d.filter((_, j) => j !== i));
    const next = rows.filter((_, j) => j !== i);
    onChange(next.length > 1 ? balanced(next) : next.map((r) => withAmount(r, bankDir, Math.abs(netOf(l)))));
  }

  return (
    <div className="mt-3 space-y-2 rounded-control border border-line/60 p-3 text-[13px]">
      <p className="text-ink-muted">
        {t("Split into cash book lines. The first row takes what the others leave.")}
        {remembered && <span className="text-ink-soft"> {t("Split the same way as last time for this payee.")}</span>}
      </p>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[96px_120px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_32px] lg:items-end">
          <label className="space-y-1">
            <span className={label}>{t("Direction")}</span>
            <Select value={dirAt(i)} onChange={(e) => setDir(i, e.target.value as "in" | "out")} disabled={disabled} className="h-9">
              <option value="in">{t("In")}</option>
              <option value="out">{t("Out")}</option>
            </Select>
          </label>
          <label className="space-y-1">
            <span className={label}>{t("Amount")}</span>
            <AmountInput value={r.amountIn || r.amountOut} onChange={(n) => update(i, withAmount(r, dirAt(i), n), true)} disabled={disabled} />
          </label>
          <label className="space-y-1">
            <span className={label}>{t("Category")}</span>
            <Select value={r.categoryId} onChange={(e) => update(i, { categoryId: e.target.value })} disabled={disabled} className="h-9">
              <option value="">{t("Uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn ? `${c.nameZh} · ${c.nameEn}` : c.nameZh}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className={label}>{t("Purpose")}</span>
            <input value={r.purpose} onChange={(e) => update(i, { purpose: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
          </label>
          <label className="space-y-1">
            <span className={label}>{t("Party")}</span>
            <input value={r.party} onChange={(e) => update(i, { party: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
          </label>
          <label className="space-y-1">
            <span className={label}>{t("Memo")}</span>
            <input value={r.memo} onChange={(e) => update(i, { memo: e.target.value })} disabled={disabled} className={cn(fieldClass, "h-9")} />
          </label>
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            title={t("Remove row")}
            className="flex h-9 w-8 items-center justify-center rounded text-ink-soft hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          {t("Add row")}
        </Button>
        <span className={cn("tnum ml-auto", same(left, 0) ? "text-ink-muted" : "text-amber-700 dark:text-amber-300")}>
          {t("Left to allocate")} {l.currency} {formatMoney(left)}
        </span>
      </div>
    </div>
  );
}

/** A money field that keeps what is typed ("5181.") while passing the number up. */
function AmountInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }) {
  const show = (n: number) => (n ? String(n) : "");
  const parse = (s: string) => Number(s.replace(/,/g, "") || 0);
  const [text, setText] = useState(show(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(text) !== value) setText(show(value));
  }
  return (
    <input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (Number.isFinite(n) && n >= 0) onChange(round2(n));
      }}
      disabled={disabled}
      className={cn(fieldClass, "tnum h-9")}
    />
  );
}

function Statements({ rows }: { rows: StatementCheck[] }) {
  const { t } = useI18n();
  const { sorted, sort, toggle } = useSort(rows, {
    month: (s) => s.periodStart,
    account: (s) => s.account,
    bank: (s) => s.bankClosing,
    book: (s) => s.bookClosing,
    // Matches first, then "matches once approved", then by size of the gap.
    check: (s) => (same(s.bookClosing, s.bankClosing) ? -2 : same(s.afterApproval, s.bankClosing) ? -1 : Math.abs(s.bookClosing - s.bankClosing)),
    uploaded: (s) => s.uploadedAt,
  });
  if (rows.length === 0) return null;
  return (
    <section className={cn(card, "p-5")}>
      <h2 className="text-base font-semibold text-ink">{t("Statements")}</h2>
      <p className="text-[13px] text-ink-muted">{t("Each uploaded month's closing balance against the cash book, as it stands now.")}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="tnum w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="py-2 pr-3">
                <SortButton sortKey="month" sort={sort} onSort={toggle}>{t("Month")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="account" sort={sort} onSort={toggle}>{t("Account")}</SortButton>
              </th>
              <th className="py-2 pr-3 text-right">
                <SortButton sortKey="bank" sort={sort} onSort={toggle}>{t("Bank closing")}</SortButton>
              </th>
              <th className="py-2 pr-3 text-right">
                <SortButton sortKey="book" sort={sort} onSort={toggle}>{t("Book now")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="check" sort={sort} onSort={toggle}>{t("Check")}</SortButton>
              </th>
              <th className="py-2">
                <SortButton sortKey="uploaded" sort={sort} onSort={toggle}>{t("Uploaded")}</SortButton>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const ok = same(s.bookClosing, s.bankClosing);
              const okLater = !ok && same(s.afterApproval, s.bankClosing);
              return (
                <tr key={s.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3 text-ink">{formatMonth(s.periodStart)}</td>
                  <td className="py-2 pr-3 text-ink-muted" title={s.file}>
                    {s.account}
                  </td>
                  <td className="py-2 pr-3 text-right text-ink">
                    <span className="mr-1 text-[11px] text-ink-soft">{s.currency}</span>
                    {formatMoney(s.bankClosing)}
                  </td>
                  <td className="py-2 pr-3 text-right text-ink">{formatMoney(s.bookClosing)}</td>
                  <td className="py-2 pr-3">
                    {ok ? (
                      <Badge tone="success">{t("Matches the bank")}</Badge>
                    ) : okLater ? (
                      <Badge tone="warning">{t("Matches once approved")}</Badge>
                    ) : (
                      <Badge tone="warning">{t("Differs by {0}", formatMoney(s.bookClosing - s.bankClosing))}</Badge>
                    )}
                  </td>
                  <td className="py-2 text-ink-muted">{formatDate(s.uploadedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RejectedList({ rows }: { rows: QueueLine[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const canEdit = useCan("statementImport", "EDIT");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { sorted, sort, toggle } = useSort(rows, {
    ...LINE_SORT,
    decided: (r) => r.decidedAt,
    by: (r) => r.decidedBy,
  });
  if (rows.length === 0) return null;

  return (
    <section className={cn(card, "p-5")}>
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-rose-600 dark:text-rose-300" />
        <h2 className="text-base font-semibold text-ink">{t("Rejected")}</h2>
        <span className="rounded-full bg-overlay/[0.06] px-2 text-[12px] text-ink-muted">{rows.length}</span>
      </div>
      <p className="text-[13px] text-ink-muted">{t("Rejected lines aren't queued again when the statement is uploaded again. Restore one to review it again.")}</p>
      <div className="mt-3 max-h-[360px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="py-2 pr-3">
                <SortButton sortKey="date" sort={sort} onSort={toggle}>{t("Date")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="line" sort={sort} onSort={toggle}>{t("Line")}</SortButton>
              </th>
              <th className="py-2 pr-3 text-right">
                <SortButton sortKey="amount" sort={sort} onSort={toggle}>{t("Amount")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="decided" sort={sort} onSort={toggle}>{t("Rejected")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="by" sort={sort} onSort={toggle}>{t("By")}</SortButton>
              </th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{formatDate(r.date)}</td>
                <td className="max-w-[320px] py-2 pr-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={r.kind} />
                    <span className="truncate text-ink">{r.purpose || r.description}</span>
                  </span>
                  <span className="block truncate text-[12px] text-ink-soft">{r.account}</span>
                </td>
                <td className="py-2 pr-3 text-right">
                  <Amount line={r} />
                </td>
                <td className="py-2 pr-3 text-ink-muted">{formatDate(r.decidedAt)}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.decidedBy ?? "—"}</td>
                <td className="py-2 text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busyId === r.id}
                      onClick={async () => {
                        setBusyId(r.id);
                        await restoreStatementLine(r.id);
                        setBusyId(null);
                        router.refresh();
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t("Restore")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const LINE_SORT: SortAccessors<QueueLine> = {
  date: (r) => r.date,
  line: (r) => r.purpose || r.description,
  amount: (r) => r.amountIn - r.amountOut,
};

function RecentList({ rows }: { rows: QueueLine[] }) {
  const { t } = useI18n();
  const { sorted, sort, toggle } = useSort(rows, {
    ...LINE_SORT,
    status: (r) => r.status,
    decided: (r) => r.decidedAt,
  });
  return (
    <section className={cn(card, "p-5")}>
      <h2 className="text-base font-semibold text-ink">{t("Recently imported")}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="py-2 pr-3">
                <SortButton sortKey="date" sort={sort} onSort={toggle}>{t("Date")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="line" sort={sort} onSort={toggle}>{t("Line")}</SortButton>
              </th>
              <th className="py-2 pr-3 text-right">
                <SortButton sortKey="amount" sort={sort} onSort={toggle}>{t("Amount")}</SortButton>
              </th>
              <th className="py-2 pr-3">
                <SortButton sortKey="status" sort={sort} onSort={toggle}>{t("Status")}</SortButton>
              </th>
              <th className="py-2">
                <SortButton sortKey="decided" sort={sort} onSort={toggle}>{t("Imported")}</SortButton>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{formatDate(r.date)}</td>
                <td className="max-w-[360px] py-2 pr-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <KindBadge kind={r.kind} />
                    <span className="truncate text-ink">{r.purpose || r.description}</span>
                  </span>
                  <Link
                    href={`/cash/ledger?account=${r.accountId}`}
                    className="block truncate text-[12px] text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100"
                  >
                    {r.account}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-right">
                  <Amount line={r} />
                </td>
                <td className="py-2 pr-3">
                  {r.status === "IN_EXCEL" ? <Badge tone="outline">{t("Now in Excel")}</Badge> : <Badge tone="success">{t("In cash book")}</Badge>}
                </td>
                <td className="py-2 text-ink-muted">
                  {formatDate(r.decidedAt)}
                  {r.decidedBy && <span className="text-ink-soft"> · {r.decidedBy}</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-soft">
                  {t("No statement lines imported yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProgressBar({ progress, onStop }: { progress: Progress; onStop: () => void }) {
  const { t } = useI18n();
  const [stopping, setStopping] = useState(false);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[12px] text-ink-muted">
        <span>{progress.label}</span>
        <span className="flex items-center gap-3">
          <span className="tnum">{pct}%</span>
          <button
            type="button"
            onClick={() => {
              setStopping(true);
              onStop();
            }}
            disabled={stopping}
            className="rounded px-1.5 py-0.5 text-ink-soft hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-60"
          >
            {stopping ? t("Stopping…") : t("Stop")}
          </button>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay/[0.08]">
        <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-control border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}
