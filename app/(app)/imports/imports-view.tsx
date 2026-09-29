"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, Inbox, MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import { StatusBadge } from "@/components/ui/badge";
import { fieldClass } from "@/components/ui/form-controls";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { dismissReview, finishMailboxCheck, importMailboxBatch, resolveReview, scanMailbox, uploadPdfs } from "./actions";

type Outcome = { status: string; label: string; number?: string; client?: string; reason?: string; invoiceId?: string };
type Pending = { id: string; subject: string; filename: string; receivedAt: string; reason: string; parsed: Record<string, string | number | null> };
type Progress = { phase: "scanning" | "importing"; done: number; total: number };
type Recent = { id: string; number: string; client: string; invoiceDate: string; usdAmount: number; status: string; importedAt: string };

const card = "glass-panel neon-edge rounded-card p-5";
const BATCH = 5;

export function ImportsView({
  mailbox,
  clients,
  pending,
  recent,
}: {
  mailbox: { user: string; folder: string; prefix: string } | null;
  clients: { id: string; name: string; alias: string }[];
  pending: Pending[];
  recent: Recent[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending_, start] = useTransition();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [unmatched, setUnmatched] = useState<{ seen: number; subjects: string[] } | null>(null);
  const stopRef = useRef(false);
  const { t } = useI18n();
  const busy = pending_ || progress !== null;
  const prefix = mailbox?.prefix ?? "";

  async function checkMailbox() {
    setError(null);
    setOutcomes(null);
    setAlreadyDone(0);
    setStopped(false);
    setUnmatched(null);
    stopRef.current = false;
    setProgress({ phase: "scanning", done: 0, total: 0 });
    try {
      const scan = await scanMailbox();
      if (!scan.ok) return setError(scan.error);
      setAlreadyDone(scan.alreadyDone);
      if (!scan.items.length && !scan.alreadyDone) setUnmatched({ seen: scan.seen, subjects: scan.otherSubjects });
      const uids = scan.items.map((i) => i.uid);
      const all: Outcome[] = [];
      setOutcomes([]);
      setProgress({ phase: "importing", done: 0, total: uids.length });
      for (let i = 0; i < uids.length; i += BATCH) {
        if (stopRef.current) {
          setStopped(true);
          break;
        }
        const res = await importMailboxBatch(uids.slice(i, i + BATCH));
        if (!res.ok) {
          setError(res.error);
          break;
        }
        all.push(...res.outcomes);
        setOutcomes([...all]);
        setProgress({ phase: "importing", done: Math.min(i + BATCH, uids.length), total: uids.length });
      }
      await finishMailboxCheck();
      router.refresh();
    } catch {
      setError("The mailbox check was interrupted. Run it again to continue; finished invoices are kept.");
    } finally {
      setProgress(null);
    }
  }

  function run(fn: () => Promise<{ ok: true; outcomes: Outcome[] } | { ok: false; error: string }>) {
    setError(null);
    setOutcomes(null);
    setAlreadyDone(0);
    setStopped(false);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      setOutcomes(res.outcomes);
      router.refresh();
    });
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    run(() => uploadPdfs(form));
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
              <MailCheck className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-ink">{t("Invoice mailbox")}</h2>
              {mailbox ? (
                <p className="text-[13px] text-ink-muted">
                  {t("Reading {0} / {1}. Emails whose subject starts with “Invoice on” are checked daily; anything already imported is skipped.", mailbox.user, mailbox.folder)}
                </p>
              ) : (
                <p className="text-[13px] text-ink-muted">
                  {t("Not connected yet. Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD for a mailbox that receives a copy of the billing-system emails. Until then, upload the PDFs here.")}
                </p>
              )}
            </div>
          </div>
          <Button className="mt-4" variant="secondary" onClick={checkMailbox} disabled={!mailbox || busy} loading={progress !== null}>
            <RefreshCw className="h-4 w-4" />
            {t("Check mailbox now")}
          </Button>
          {progress && <MailboxProgress progress={progress} onStop={() => (stopRef.current = true)} />}
        </section>

        <section className={card}>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              upload(e.dataTransfer.files);
            }}
            className={cn(
              "flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed px-4 text-center transition-colors",
              dragging ? "border-brand-400 bg-brand-500/[0.08]" : "border-overlay/20 hover:border-brand-400/60 hover:bg-brand-500/[0.05]"
            )}
          >
            <FileUp className="h-6 w-6 text-brand-600 dark:text-brand-300" />
            <span className="text-sm font-medium text-ink">{t("Drop system invoice PDFs")}</span>
            <span className="text-[12px] text-ink-soft">{t("or click to choose. Several at once is fine.")}</span>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        </section>
      </div>

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      {outcomes && (
        <section className={card}>
          <h2 className="text-base font-semibold text-ink">{t("Result")}</h2>
          <ResultSummary outcomes={outcomes} alreadyDone={alreadyDone} stopped={stopped} running={progress !== null} />
          {unmatched && (
            <div className="mt-2 text-[13px] text-ink-muted">
              <p>{t("{0} emails in the last 40 days, none with a subject starting with “{1}”.", unmatched.seen, prefix)}</p>
              {unmatched.subjects.length > 0 && (
                <>
                  <p className="mt-2 text-[12px] text-ink-soft">{t("Latest subjects in the inbox:")}</p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[12px]">
                    {unmatched.subjects.map((s, i) => (
                      <li key={i} className="truncate">
                        {s || t("(no subject)")}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <ul className="mt-3 max-h-[360px] space-y-1.5 overflow-y-auto text-[13px]">
            {outcomes.map((o, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={cn(
                    "w-20 shrink-0 font-medium",
                    o.status === "imported" ? "text-emerald-600 dark:text-emerald-300" : o.status === "review" ? "text-amber-600 dark:text-amber-300" : "text-ink-soft"
                  )}
                >
                  {t(o.status)}
                </span>
                <span className="min-w-0 truncate text-ink-muted">
                  {o.label}
                  {o.number ? ` · ${o.number}` : ""}
                  {o.client ? ` · ${o.client}` : ""}
                  {o.reason ? ` · ${t(o.reason)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          <h2 className="text-base font-semibold text-ink">{t("Needs review")}</h2>
          <span className="rounded-full bg-overlay/[0.06] px-2 text-[12px] text-ink-muted">{pending.length}</span>
        </div>
        <p className="text-[13px] text-ink-muted">{t("Invoices the importer could not match to a client or could not read.")}</p>
        <div className="mt-4 space-y-3">
          {pending.map((p) => (
            <ReviewRow key={p.id} item={p} clients={clients} />
          ))}
          {pending.length === 0 && <p className="py-6 text-center text-[13px] text-ink-soft">{t("Nothing waiting.")}</p>}
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-ink">{t("Recently imported")}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                <th className="py-2 pr-3">{t("Invoice no.")}</th>
                <th className="py-2 pr-3">{t("Client")}</th>
                <th className="py-2 pr-3">{t("Date")}</th>
                <th className="py-2 pr-3 text-right">USD</th>
                <th className="py-2 pr-3">{t("Status")}</th>
                <th className="py-2">{t("Imported")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/invoices/${r.id}`} className="font-mono text-brand-700 dark:text-brand-200 hover:text-brand-900 dark:hover:text-brand-100">
                      {r.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-ink">{r.client}</td>
                  <td className="py-2 pr-3 text-ink-muted">{formatDate(r.invoiceDate)}</td>
                  <td className="tnum py-2 pr-3 text-right">{formatMoney(r.usdAmount)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-2 text-ink-muted">{formatDate(r.importedAt)}</td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-soft">
                    {t("No system invoices imported yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReviewRow({ item, clients }: { item: Pending; clients: { id: string; name: string; alias: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { t } = useI18n();
  const match = clients.find((c) => c.name.toLowerCase() === text.trim().toLowerCase());
  const p = item.parsed;

  return (
    <div className="rounded-card border border-line/70 p-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.subject || item.filename}</p>
          <p className="text-[12px] text-amber-700 dark:text-amber-200">{t(item.reason)}</p>
        </div>
        <a href={`/api/imports/${item.id}/pdf`} target="_blank" rel="noreferrer" className="text-[13px] text-brand-700 dark:text-brand-200 hover:text-brand-900 dark:hover:text-brand-100">
          {t("Open PDF")}
        </a>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-5">
        {(
          [
            ["Invoice no.", p.number],
            ["Client name", p.clientName],
            ["Reference", p.reference],
            ["Date", p.invoiceDate ? formatDate(String(p.invoiceDate)) : null],
            ["Amount", p.amount !== undefined && p.amount !== null ? `${p.currency ?? ""} ${formatMoney(Number(p.amount))}` : null],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-ink-soft">{t(k)}</dt>
            <dd className="truncate font-mono text-ink">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          list={`review-clients-${item.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Assign to client")}
          className={cn(fieldClass, "h-9 max-w-sm")}
        />
        <datalist id={`review-clients-${item.id}`}>
          {clients.map((c) => (
            <option key={c.id} value={c.name}>
              {c.alias}
            </option>
          ))}
        </datalist>
        <Button
          size="sm"
          disabled={!match || !p.number}
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await resolveReview(item.id, match!.id);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
        >
          {t("Import")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await dismissReview(item.id);
              router.refresh();
            })
          }
        >
          {t("Dismiss")}
        </Button>
        {error && <span className="text-[12px] text-rose-600 dark:text-rose-300">{t(error)}</span>}
      </div>
    </div>
  );
}

function MailboxProgress({ progress, onStop }: { progress: Progress; onStop: () => void }) {
  const { t } = useI18n();
  const [stopping, setStopping] = useState(false);
  const scanning = progress.phase === "scanning";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[12px] text-ink-muted">
        <span>
          {scanning
            ? t("Looking for new invoice emails…")
            : progress.total === 0
              ? t("No new invoice emails found.")
              : t("Importing {0} of {1} emails…", progress.done, progress.total)}
        </span>
        {!scanning && progress.total > 0 && (
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
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay/[0.08]">
        <div
          className={cn("h-full rounded-full bg-brand-500 transition-[width] duration-300", scanning && "w-1/3 animate-pulse")}
          style={scanning ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ResultSummary({ outcomes, alreadyDone, stopped, running }: { outcomes: Outcome[]; alreadyDone: number; stopped: boolean; running: boolean }) {
  const { t } = useI18n();
  const count = (s: string) => outcomes.filter((o) => o.status === s).length;
  const parts = (
    [
      ["imported", "Imported {0}"],
      ["duplicate", "Duplicate {0}"],
      ["review", "Needs review {0}"],
      ["skipped", "Skipped {0}"],
    ] as const
  )
    .filter(([s]) => count(s) > 0)
    .map(([s, label]) => t(label, count(s)));

  return (
    <div className="mt-2 space-y-1 text-[13px] text-ink-muted">
      {outcomes.length === 0 && !running && <p>{t("No new invoice emails found.")}</p>}
      {parts.length > 0 && <p className="font-medium text-ink">{parts.join(" … ")}</p>}
      {alreadyDone > 0 && <p>{t("{0} emails were imported earlier and skipped.", alreadyDone)}</p>}
      {stopped && <p className="text-amber-700 dark:text-amber-200">{t("Stopped. Run the check again to import the rest.")}</p>}
    </div>
  );
}