"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form-controls";
import { useCan } from "@/components/shell/user-context";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney, formatMonth } from "@/lib/utils";
import type { MonthPreview, ProposedLine, StatementPreview } from "@/lib/statements/reconcile";
import { applyStatements, previewStatements, type ApplyChoices } from "./actions";

const card = "glass-panel neon-edge rounded-card";
type Category = { id: string; nameZh: string; nameEn: string; kind: string };

export function StatementImportView({ categories }: { categories: Category[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const canEdit = useCan("STAFF");
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function formFor(list: File[], choices: ApplyChoices) {
    const form = new FormData();
    list.forEach((f) => form.append("files", f));
    form.append("choices", JSON.stringify(choices));
    return form;
  }

  function load(list: File[], accountChoices: Record<string, string>) {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await previewStatements(formFor(list, { accounts: accountChoices }));
      if (!res.ok) {
        setPreview(null);
        return setError(res.error);
      }
      setPreview(res);
      setExcluded(new Set());
      setCats({});
      setDetails(Object.fromEntries(res.accounts.map((a) => [a.accountId, new Set(a.fields.filter((f) => f.tick).map((f) => f.key))])));
    });
  }

  function choose(list: FileList | null) {
    const pdfs = Array.from(list ?? []).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) return;
    setFiles(pdfs);
    setAccounts({});
    load(pdfs, {});
  }

  function pickAccount(month: MonthPreview, accountId: string) {
    const next = { ...accounts, [`${month.accountNumber}:${month.currency}`]: accountId };
    setAccounts(next);
    load(files, next);
  }

  function apply() {
    if (!preview) return;
    const choices: ApplyChoices = {
      accounts,
      excluded: Array.from(excluded),
      categories: cats,
      details: Object.fromEntries(Object.entries(details).map(([k, v]) => [k, Array.from(v)])),
    };
    start(async () => {
      const res = await applyStatements(formFor(files, choices));
      if (!res.ok) return setError(res.error);
      setDone(
        res.added
          ? t("Added {0} lines to the cash book.", res.added)
          : t("Nothing new to add; the cash book already has everything on these statements."),
      );
      setPreview(null);
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const allProposed = preview?.months.flatMap((m) => m.proposed) ?? [];
  const included = allProposed.filter((l) => !excluded.has(l.key));
  const net = (l: ProposedLine) => l.amountIn - l.amountOut;
  /** Book balance after the chosen lines, for one account up to a date. */
  const added = (accountId: string, until: string, inclusive: boolean) =>
    included.filter((l) => l.accountId === accountId && (inclusive ? l.date <= until : l.date < until)).reduce((s, l) => s + net(l), 0);
  const unlinked = preview?.months.some((m) => !m.accountId) ?? false;

  return (
    <div className="space-y-6">
      <section className={cn(card, "p-5")}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending || !canEdit}
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
          <span className="text-sm font-medium text-ink">{pending && !preview ? t("Reading statements…") : t("Drop bank statement PDFs")}</span>
          <span className="text-[12px] text-ink-soft">{t("ANEXT for now. Several months at once is fine; they are checked oldest first.")}</span>
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => choose(e.target.files)} />
      </section>

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      {done && (
        <p className="flex flex-wrap items-center gap-2 rounded-control border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4" />
          {done}
          <Link href="/cash" className="font-medium underline underline-offset-2">
            {t("Cash position")}
          </Link>
          <Link href="/cash/ledger" className="font-medium underline underline-offset-2">
            {t("Cash book")}
          </Link>
        </p>
      )}

      {preview && (
        <>
          {preview.errors.map((e) => (
            <p key={e.file} className="rounded-control border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-800 dark:text-amber-200">
              <span className="font-medium">{e.file}:</span> {t(e.message)}
            </p>
          ))}

          {preview.accounts.map((a) => (
            <section key={a.accountId} className={card}>
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-base font-semibold text-ink">{t("Account details · {0}", a.label)}</h2>
                <p className="mt-0.5 text-[13px] text-ink-muted">{t("Ticked fields are copied from the statement to Settings.")}</p>
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
            </section>
          ))}

          {preview.months.map((m) => (
            <MonthCard
              key={m.id}
              month={m}
              categories={categories}
              candidates={preview.candidates[m.currency] ?? []}
              excluded={excluded}
              cats={cats}
              bookOpening={m.accountId ? m.baseOpening + added(m.accountId, m.periodStart, false) : null}
              bookClosing={m.accountId ? m.baseClosing + added(m.accountId, m.periodEnd, true) : null}
              onToggle={(key) =>
                setExcluded((s) => {
                  const n = new Set(s);
                  if (n.has(key)) n.delete(key);
                  else n.add(key);
                  return n;
                })
              }
              onCategory={(key, id) => setCats((c) => ({ ...c, [key]: id }))}
              onAccount={(id) => pickAccount(m, id)}
            />
          ))}

          {preview.months.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {unlinked && <span className="text-[13px] text-amber-700 dark:text-amber-300">{t("Pick the account for every statement first.")}</span>}
              <Button onClick={apply} loading={pending} disabled={!canEdit || unlinked}>
                {included.length ? t("Import {0} lines", included.length) : t("Confirm, nothing to add")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MonthCard({
  month: m,
  categories,
  candidates,
  excluded,
  cats,
  bookOpening,
  bookClosing,
  onToggle,
  onCategory,
  onAccount,
}: {
  month: MonthPreview;
  categories: Category[];
  candidates: { id: string; label: string }[];
  excluded: Set<string>;
  cats: Record<string, string>;
  bookOpening: number | null;
  bookClosing: number | null;
  onToggle: (key: string) => void;
  onCategory: (key: string, id: string) => void;
  onAccount: (id: string) => void;
}) {
  const { t } = useI18n();
  const [showMatched, setShowMatched] = useState(false);
  const closingOk = bookClosing !== null && Math.abs(bookClosing - m.closing) < 0.005;
  const missing = m.proposed.filter((l) => l.kind === "entry");

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {formatMonth(m.periodStart)} · {m.accountLabel || `${m.bank} ${m.accountNumber} · ${m.currency}`}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">{m.file}</p>
        </div>
        {bookClosing !== null &&
          (closingOk ? (
            <Badge tone="success">{t("Matches the bank")}</Badge>
          ) : (
            <Badge tone="warning">{t("Differs by {0}", formatMoney(bookClosing - m.closing))}</Badge>
          ))}
      </div>

      <div className="space-y-4 px-5 py-4">
        {!m.accountId && (
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
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

        <dl className="tnum grid gap-3 text-sm sm:grid-cols-2">
          <Figure label="Opening balance" bank={m.opening} book={bookOpening} currency={m.currency} />
          <Figure label="Closing balance" bank={m.closing} book={bookClosing} currency={m.currency} after />
        </dl>

        {m.openingWarning !== null && (
          <Warning>{t("The book's opening differs from the bank's by {0}. Check the previous month.", formatMoney(-m.openingWarning))}</Warning>
        )}
        {m.interestAlready && <p className="text-[13px] text-ink-soft">{t("Interest for this month was imported before.")}</p>}

        {m.proposed.length > 0 && (
          <div>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-soft">{t("To add")}</h3>
            <div className="overflow-x-auto">
              <table className="tnum w-full min-w-[640px] text-[13px]">
                <tbody>
                  {m.proposed.map((l) => (
                    <tr key={l.key} className={cn("border-t border-line/50", excluded.has(l.key) && "opacity-50")}>
                      <td className="w-8 py-2">
                        <input type="checkbox" checked={!excluded.has(l.key)} onChange={() => onToggle(l.key)} className="h-4 w-4 accent-brand-600" />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{formatDate(l.date)}</td>
                      <td className="py-2 pr-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {l.kind === "entry" && <Badge tone="warning">{t("Missing in Excel")}</Badge>}
                          {l.kind === "interest" && <Badge tone="outline">{t("Interest")}</Badge>}
                          {l.kind === "opening" && <Badge tone="outline">{t("Opening adjustment")}</Badge>}
                          <span className="text-ink">{l.purpose}</span>
                        </span>
                        <span className="block max-w-[420px] truncate text-[12px] text-ink-soft" title={l.memo}>
                          {l.memo}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <Select value={cats[l.key] ?? l.categoryId} onChange={(e) => onCategory(l.key, e.target.value)} className="min-w-[150px]">
                          <option value="">{t("Uncategorized")}</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nameEn ? `${c.nameZh} · ${c.nameEn}` : c.nameZh}
                            </option>
                          ))}
                        </Select>
                        {l.suggested === "history" && <span className="mt-0.5 block text-[11px] text-ink-soft">{t("Suggested from earlier lines")}</span>}
                      </td>
                      <td className={cn("whitespace-nowrap py-2 text-right", l.amountIn ? "text-emerald-700 dark:text-emerald-300" : "text-ink")}>
                        {l.amountIn ? "+" : "−"}
                        {formatMoney(l.amountIn || l.amountOut)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {missing.length > 0 && <p className="mt-2 text-[12px] text-ink-soft">{t("Lines marked Missing in Excel are on the bank statement but not in your workbook; add them to Excel too while you run both.")}</p>}
          </div>
        )}

        {m.bookOnly.length > 0 && (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("Not on the bank statement")}
            </h3>
            <ul className="space-y-1 text-[13px]">
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
            <button type="button" onClick={() => setShowMatched((s) => !s)} className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
              <ChevronDown className={cn("h-4 w-4 transition-transform", !showMatched && "-rotate-90")} />
              {t("{0} entries already in the cash book", m.matched.length)}
            </button>
            {showMatched && (
              <ul className="mt-2 space-y-1 text-[13px]">
                {m.matched.map((x, i) => (
                  <li key={i} className="tnum flex flex-wrap gap-x-3">
                    <span className="text-ink-muted">{formatDate(x.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={x.description}>
                      {x.description}
                    </span>
                    {x.bookDate !== x.date && <span className="text-[12px] text-ink-soft">{t("booked {0}", formatDate(x.bookDate))}</span>}
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

function Figure({ label, bank, book, currency, after }: { label: string; bank: number; book: number | null; currency: string; after?: boolean }) {
  const { t } = useI18n();
  const ok = book !== null && Math.abs(book - bank) < 0.005;
  return (
    <div className="rounded-control border border-line/70 px-4 py-3">
      <dt className="text-[12px] text-ink-soft">{t(label)}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-ink">
          <span className="mr-1 text-[11px] text-ink-soft">{currency}</span>
          {formatMoney(bank)}
          <span className="ml-1.5 text-[11px] font-normal text-ink-soft">{t("bank")}</span>
        </span>
        {book !== null && (
          <span className={cn("text-[13px]", ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
            {formatMoney(book)} {t(after ? "book after import" : "book")}
          </span>
        )}
      </dd>
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
