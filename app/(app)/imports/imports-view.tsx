"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCheck, FileUp, Inbox, MailCheck, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan } from "@/components/shell/user-context";
import { StatusBadge } from "@/components/ui/badge";
import { fieldClass } from "@/components/ui/form-controls";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import {
  approveImport,
  finishMailboxCheck,
  rejectImport,
  restoreImport,
  scanMailbox,
  stageMailboxBatch,
  uploadPdfs,
} from "./actions";

type Outcome = { status: string; label: string; number?: string; client?: string; reason?: string };
type ClientRef = { id: string; name: string; alias: string };
type Pending = {
  id: string;
  subject: string;
  filename: string;
  receivedAt: string;
  reason: string;
  parsed: Record<string, string | number | null>;
  client: { id: string; name: string } | null;
};
type Rejected = { id: string; subject: string; number: string | null; client: string | null; reason: string; rejectedAt: string; rejectedBy: string | null };
type Recent = { id: string; number: string; client: string; invoiceDate: string; usdAmount: number; status: string; importedAt: string };
type Known = { waiting: number; rejected: number; imported: number; duplicate: number };
type ScanInfo = { known: Known; rejected: { subject: string; number: string | null }[]; seen: number; otherSubjects: string[] };
type Progress = { label: string; done: number; total: number } | { label: string; indeterminate: true };

const card = "glass-panel neon-edge rounded-card p-5";
const BATCH = 5;

export function ImportsView({
  mailbox,
  clients,
  pending,
  rejected,
  recent,
}: {
  mailbox: { user: string; folder: string; prefix: string } | null;
  clients: ClientRef[];
  pending: Pending[];
  rejected: Rejected[];
  recent: Recent[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [scan, setScan] = useState<ScanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [stopped, setStopped] = useState(false);
  const [uploading, startUpload] = useTransition();
  const { t } = useI18n();
  const canEdit = useCan("systemImports", "EDIT");
  const busy = uploading || progress !== null;

  function reset() {
    setError(null);
    setOutcomes(null);
    setScan(null);
    setStopped(false);
    stopRef.current = false;
  }

  async function checkMailbox() {
    reset();
    setProgress({ label: t("Looking for new invoice emails…"), indeterminate: true });
    try {
      const res = await scanMailbox();
      if (!res.ok) return setError(res.error);
      setScan({ known: res.known, rejected: res.rejected, seen: res.seen, otherSubjects: res.otherSubjects });
      const uids = res.items.map((i) => i.uid);
      const all: Outcome[] = [];
      setOutcomes([]);
      for (let i = 0; i < uids.length; i += BATCH) {
        if (stopRef.current) {
          setStopped(true);
          break;
        }
        setProgress({ label: t("Reading {0} of {1} emails…", Math.min(i + BATCH, uids.length), uids.length), done: i, total: uids.length });
        const batch = await stageMailboxBatch(uids.slice(i, i + BATCH));
        if (!batch.ok) {
          setError(batch.error);
          break;
        }
        all.push(...batch.outcomes);
        setOutcomes([...all]);
      }
      await finishMailboxCheck();
      router.refresh();
    } catch {
      setError("The mailbox check was interrupted. Run it again to continue; finished invoices are kept.");
    } finally {
      setProgress(null);
    }
  }

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    reset();
    startUpload(async () => {
      const res = await uploadPdfs(form);
      if (!res.ok) return setError(res.error);
      setOutcomes(res.outcomes);
      router.refresh();
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      {canEdit && (
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
                  {t("Reading {0} / {1}. New invoice emails are checked daily and wait here for your approval.", mailbox.user, mailbox.folder)}
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
          {progress && <ProgressBar progress={progress} onStop={() => (stopRef.current = true)} />}
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
            <span className="text-sm font-medium text-ink">{uploading ? t("Reading PDFs…") : t("Drop system invoice PDFs")}</span>
            <span className="text-[12px] text-ink-soft">{t("or click to choose. Several at once is fine.")}</span>
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        </section>
      </div>
      )}

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      {outcomes && <ResultCard outcomes={outcomes} scan={scan} stopped={stopped} running={progress !== null} prefix={mailbox?.prefix ?? ""} />}

      <ApprovalQueue pending={pending} clients={clients} />
      <RejectedList rows={rejected} />

      <section className={card}>
        <h2 className="text-base font-semibold text-ink">{t("Recently imported")}</h2>
        <div className="relative mt-3 overflow-x-auto">
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
                    <Link href={`/invoices/${r.id}`} className="font-mono text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
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

function ProgressBar({ progress, onStop }: { progress: Progress; onStop?: () => void }) {
  const { t } = useI18n();
  const [stopping, setStopping] = useState(false);
  const indeterminate = "indeterminate" in progress;
  const pct = indeterminate || !progress.total ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <div className="mt-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[12px] text-ink-muted">
        <span>{progress.label}</span>
        {!indeterminate && (
          <span className="flex items-center gap-3">
            <span className="tnum">{pct}%</span>
            {onStop && (
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
            )}
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay/[0.08]">
        <div
          className={cn("h-full rounded-full bg-brand-500 transition-[width] duration-300", indeterminate && "w-1/3 animate-pulse")}
          style={indeterminate ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  queued: "New",
  waiting: "Waiting",
  rejected: "Rejected before",
  imported: "Imported before",
  duplicate: "In ledger",
  skipped: "Skipped",
};

const OUTCOME_TONE: Record<string, string> = {
  queued: "text-brand-700 dark:text-brand-200",
  rejected: "text-rose-600 dark:text-rose-300",
  waiting: "text-amber-600 dark:text-amber-300",
};

function ResultCard({ outcomes, scan, stopped, running, prefix }: { outcomes: Outcome[]; scan: ScanInfo | null; stopped: boolean; running: boolean; prefix: string }) {
  const { t } = useI18n();
  const count = (s: string) => outcomes.filter((o) => o.status === s).length;
  const known = scan?.known ?? { waiting: 0, rejected: 0, imported: 0, duplicate: 0 };
  const totals = (
    [
      ["New, waiting for your approval {0}", count("queued")],
      ["Already waiting for approval {0}", count("waiting") + known.waiting],
      ["Rejected before {0}", count("rejected") + known.rejected],
      ["Imported before {0}", count("imported") + known.imported],
      ["Already in the ledger {0}", count("duplicate") + known.duplicate],
      ["Skipped {0}", count("skipped")],
    ] as const
  ).filter(([, n]) => n > 0);
  const flagged = [
    ...(scan?.rejected ?? []),
    ...outcomes.filter((o) => o.status === "rejected").map((o) => ({ subject: o.label, number: o.number ?? null })),
  ];
  const nothingNew = !running && outcomes.length === 0;
  const noMatches = nothingNew && scan && scan.seen >= 0 && !totals.length;

  return (
    <section className={card}>
      <h2 className="text-base font-semibold text-ink">{t("Result")}</h2>
      {totals.length > 0 && <p className="mt-2 text-[13px] font-medium text-ink">{totals.map(([label, n]) => t(label, n)).join(" · ")}</p>}
      {nothingNew && <p className="mt-2 text-[13px] text-ink-muted">{t("No new invoice emails found.")}</p>}
      {stopped && <p className="mt-1 text-[13px] text-amber-700 dark:text-amber-200">{t("Stopped. Run the check again to read the rest.")}</p>}

      {flagged.length > 0 && (
        <div className="mt-3 rounded-control border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-rose-700 dark:text-rose-200">
            <Ban className="h-3.5 w-3.5" />
            {t("Rejected before, so not queued again:")}
          </p>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[12px] text-ink-muted">
            {flagged.map((f, i) => (
              <li key={i} className="truncate">
                {f.number ? <span className="font-mono text-ink">{f.number}</span> : null}
                {f.number ? " · " : ""}
                {f.subject}
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcomes.length > 0 && (
        <ul className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto text-[13px]">
          {outcomes.map((o, i) => (
            <li key={i} className="flex gap-3">
              <span className={cn("w-28 shrink-0 font-medium", OUTCOME_TONE[o.status] ?? "text-ink-soft")}>{t(OUTCOME_LABEL[o.status] ?? o.status)}</span>
              <span className="min-w-0 truncate text-ink-muted">
                {o.label}
                {o.number ? ` · ${o.number}` : ""}
                {o.client ? ` · ${o.client}` : ""}
                {o.reason ? ` · ${t(o.reason)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {noMatches && scan.seen > 0 && (
        <div className="mt-2 text-[13px] text-ink-muted">
          <p>{t("{0} emails in the last 40 days, none with a subject starting with “{1}”.", scan.seen, prefix)}</p>
          {scan.otherSubjects.length > 0 && (
            <>
              <p className="mt-2 text-[12px] text-ink-soft">{t("Latest subjects in the inbox:")}</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[12px]">
                {scan.otherSubjects.map((s, i) => (
                  <li key={i} className="truncate">
                    {s || t("(no subject)")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ApprovalQueue({ pending, clients }: { pending: Pending[]; clients: ClientRef[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const canEdit = useCan("systemImports", "EDIT");
  const [bulk, setBulk] = useState<Progress | null>(null);
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const stopRef = useRef(false);
  const visible = pending.filter((p) => !done.has(p.id));
  const ready = visible.filter((p) => p.client && !p.reason && p.parsed.number);

  async function approveAll() {
    stopRef.current = false;
    setBulkErrors([]);
    const errors: string[] = [];
    for (let i = 0; i < ready.length; i++) {
      if (stopRef.current) break;
      const item = ready[i];
      setBulk({ label: t("Approving {0} of {1}…", i + 1, ready.length), done: i, total: ready.length });
      const res = await approveImport(item.id, item.client!.id, false);
      if (res.ok) setDone((s) => new Set(s).add(item.id));
      else errors.push(`${item.parsed.number ?? item.subject}: ${t(res.error)}`);
    }
    await finishMailboxCheck();
    setBulk(null);
    setBulkErrors(errors);
    router.refresh();
  }

  return (
    <section className={card}>
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
        {t("Nothing is posted to the ledger until you approve it. Rejected invoices are remembered and won't be queued again.")}
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
        {visible.map((p) => (
          <ReviewRow key={p.id} item={p} clients={clients} disabled={bulk !== null} />
        ))}
        {visible.length === 0 && <p className="py-6 text-center text-[13px] text-ink-soft">{t("Nothing waiting.")}</p>}
      </div>
    </section>
  );
}

function ReviewRow({ item, clients, disabled }: { item: Pending; clients: ClientRef[]; disabled: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(item.client?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { t } = useI18n();
  const match = clients.find((c) => c.name.toLowerCase() === text.trim().toLowerCase());
  const p = item.parsed;
  const ready = !item.reason && !!match && !!p.number;
  const canEdit = useCan("systemImports", "EDIT");

  return (
    <div className="rounded-card border border-line/70 p-4">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{item.subject || item.filename}</p>
          {item.reason ? (
            <p className="text-[12px] text-amber-700 dark:text-amber-200">{t(item.reason)}</p>
          ) : (
            <p className="text-[12px] text-emerald-700 dark:text-emerald-300">{t("Ready to approve.")}</p>
          )}
        </div>
        <span className="text-[12px] text-ink-soft">{formatDate(item.receivedAt)}</span>
        <a href={`/api/imports/${item.id}/pdf`} target="_blank" rel="noreferrer" className="text-[13px] text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
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
      {canEdit && (
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
          disabled={!match || !p.number || disabled}
          loading={pending}
          variant={ready ? "primary" : "secondary"}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await approveImport(item.id, match!.id);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
        >
          {t("Approve")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || disabled}
          onClick={() =>
            start(async () => {
              await rejectImport(item.id);
              router.refresh();
            })
          }
        >
          {t("Reject")}
        </Button>
        {error && <span className="text-[12px] text-rose-600 dark:text-rose-300">{t(error)}</span>}
      </div>
      )}
    </div>
  );
}

function RejectedList({ rows }: { rows: Rejected[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const canEdit = useCan("systemImports", "EDIT");
  if (rows.length === 0) return null;

  return (
    <section className={card}>
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-rose-600 dark:text-rose-300" />
        <h2 className="text-base font-semibold text-ink">{t("Rejected")}</h2>
        <span className="rounded-full bg-overlay/[0.06] px-2 text-[12px] text-ink-muted">{rows.length}</span>
      </div>
      <p className="text-[13px] text-ink-muted">
        {t("These won't be queued again. Later emails with the same invoice number are flagged as rejected. Restore one to review it again.")}
      </p>
      <div className="mt-3 max-h-[360px] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
              <th className="py-2 pr-3">{t("Invoice no.")}</th>
              <th className="py-2 pr-3">{t("Subject")}</th>
              <th className="py-2 pr-3">{t("Client")}</th>
              <th className="py-2 pr-3">{t("Rejected")}</th>
              <th className="py-2 pr-3">{t("By")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3 font-mono text-ink">{r.number ?? "—"}</td>
                <td className="max-w-[280px] truncate py-2 pr-3 text-ink-muted" title={r.subject}>
                  {r.subject || "—"}
                  {r.reason ? <span className="text-ink-soft"> · {t(r.reason)}</span> : null}
                </td>
                <td className="py-2 pr-3 text-ink-muted">{r.client ?? "—"}</td>
                <td className="py-2 pr-3 text-ink-muted">{formatDate(r.rejectedAt)}</td>
                <td className="py-2 pr-3 text-ink-muted">{r.rejectedBy ?? t("Automatic")}</td>
                <td className="py-2 text-right">
                  {canEdit && <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === r.id}
                    onClick={async () => {
                      setBusyId(r.id);
                      await restoreImport(r.id);
                      setBusyId(null);
                      router.refresh();
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("Restore")}
                  </Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
