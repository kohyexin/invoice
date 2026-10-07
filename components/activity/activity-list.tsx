"use client";

import { useState } from "react";
import {
  Building2,
  FileText,
  HardDrive,
  History,
  Inbox,
  Landmark,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { SidePanel } from "@/components/ui/side-panel";
import type { Locale, Translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ActivityRow = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  label: string;
  changes: Record<string, unknown> | null;
};

export const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Changed",
  delete: "Deleted",
  mark_paid: "Marked paid",
  approve: "Approved",
  reject: "Rejected",
  restore: "Restored",
  upload: "Uploaded",
  import: "Imported",
  invite: "Invited",
  resend_invite: "Resent invitation",
  accept_invite: "Accepted invitation",
  change_password: "Changed password",
  change_authenticator: "Changed authenticator",
  connect: "Connected",
  disconnect: "Disconnected",
};

export const ENTITY_LABEL: Record<string, string> = {
  invoice: "Invoice",
  client: "Client",
  user: "User",
  role: "Role",
  import: "System import",
  statement: "Bank statement",
  statement_line: "Statement line",
  cash_entry: "Cash book line",
  "setting:company": "Company",
  "setting:bankAccount": "Bank account",
  "setting:paymentRule": "Payment default",
  "setting:fxRate": "FX rate",
  "setting:owner": "Owner",
  "setting:invoiceType": "Invoice type",
  "setting:invoiceItem": "Invoice item",
  "setting:cashCategory": "Cash category",
  "setting:googleDrive": "Google Drive",
};

const TINT = {
  sky: "bg-sky-500/10 text-sky-600 ring-sky-500/25 dark:text-sky-300",
  emerald: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300",
  violet: "bg-violet-500/10 text-violet-600 ring-violet-500/25 dark:text-violet-300",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-300",
  brand: "bg-brand-500/10 text-brand-600 ring-brand-500/25 dark:text-brand-300",
  slate: "bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300",
};

/** Icon and tint of the timeline node for each kind of record. */
export function entityKind(entity: string): { icon: LucideIcon; node: string } {
  if (entity === "invoice") return { icon: FileText, node: TINT.sky };
  if (entity === "client") return { icon: Building2, node: TINT.emerald };
  if (entity === "import") return { icon: Inbox, node: TINT.violet };
  if (entity === "statement" || entity === "statement_line") return { icon: Landmark, node: TINT.amber };
  if (entity === "cash_entry") return { icon: Wallet, node: TINT.amber };
  if (entity === "user") return { icon: UserRound, node: TINT.brand };
  if (entity === "role") return { icon: ShieldCheck, node: TINT.violet };
  if (entity === "setting:googleDrive") return { icon: HardDrive, node: TINT.slate };
  if (entity.startsWith("setting:")) return { icon: SlidersHorizontal, node: TINT.slate };
  return { icon: History, node: TINT.slate };
}

const DOT: Record<string, string> = {
  create: "bg-emerald-500",
  import: "bg-emerald-500",
  approve: "bg-emerald-500",
  mark_paid: "bg-emerald-500",
  accept_invite: "bg-emerald-500",
  delete: "bg-rose-500",
  reject: "bg-rose-500",
  disconnect: "bg-rose-500",
  change_password: "bg-amber-500",
  change_authenticator: "bg-amber-500",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v)) return v.slice(0, 10);
  if (Array.isArray(v)) return v.length ? v.map(show).join("; ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** "receivedDate" → "Received date". */
function fieldName(field: string) {
  const words = field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isPair = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2;

function relativeTime(iso: string, locale: Locale) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
  return fullTime(iso, locale, false);
}

function fullTime(iso: string, locale: Locale, withTime = true) {
  return new Date(iso).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function summary(t: Translate, r: ActivityRow, showEntity: boolean) {
  const action = t(ACTION_LABEL[r.action] ?? r.action);
  return showEntity ? `${action} · ${t(ENTITY_LABEL[r.entity] ?? r.entity)}` : action;
}

/** Vertical timeline: a tinted icon per kind of record on a connecting rail, then a
 *  card with what happened, who did it and when. Clicking a card opens its changes. */
export function ActivityList({
  rows,
  showEntity = true,
  compact = false,
  empty = "No activity yet.",
}: {
  rows: ActivityRow[];
  showEntity?: boolean;
  compact?: boolean;
  empty?: string;
}) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = useState<ActivityRow | null>(null);

  if (!rows.length)
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <History className="h-7 w-7 text-ink-soft" />
        <p className="text-[13px] text-ink-muted">{t(empty)}</p>
      </div>
    );

  return (
    <>
      <ol>
        {rows.map((r, i) => {
          const kind = entityKind(r.entity);
          const Icon = kind.icon;
          const fields = r.changes ? Object.keys(r.changes) : [];
          const time = (
            <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums" title={fullTime(r.createdAt, locale)} suppressHydrationWarning>
              <span className={cn("h-1.5 w-1.5 rounded-full", DOT[r.action] ?? "bg-brand-500")} aria-hidden="true" />
              {relativeTime(r.createdAt, locale)}
            </span>
          );
          return (
            <li key={r.id} className={cn("relative flex", compact ? "gap-2.5" : "gap-3 sm:gap-4")}>
              <div className="relative flex flex-col items-center">
                <span className={cn("z-10 flex shrink-0 items-center justify-center rounded-xl ring-1", kind.node, compact ? "h-7 w-7" : "h-9 w-9")}>
                  <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </span>
                {i < rows.length - 1 && (
                  <span className={cn("absolute w-px bg-line/70", compact ? "top-7 h-[calc(100%+0.5rem)]" : "top-9 h-[calc(100%+0.5rem)]")} aria-hidden="true" />
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelected(r)}
                className={cn(
                  "group mb-2 min-w-0 flex-1 rounded-card border border-line/70 bg-overlay/[0.02] text-left transition-all hover:-translate-y-0.5 hover:border-brand-500/40 hover:bg-overlay/[0.05]",
                  compact ? "px-3 py-2" : "px-4 py-3"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">
                      <span className="font-medium">{summary(t, r, showEntity)}</span>
                      {r.label && <span className="text-ink-muted"> {r.label}</span>}
                    </p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                      <span className="font-medium text-ink-muted">{r.actorName}</span>
                      {compact && (
                        <>
                          <span aria-hidden="true">·</span>
                          {time}
                        </>
                      )}
                      {fields.length > 0 && (
                        <code
                          className={cn(
                            "min-w-0 max-w-full truncate rounded bg-overlay/[0.06] px-1.5 py-px font-mono text-[10px] tracking-tight text-ink-soft",
                            compact ? "block basis-full" : "sm:max-w-[320px]"
                          )}
                        >
                          {fields.map(fieldName).join(", ")}
                        </code>
                      )}
                    </div>
                  </div>
                  {!compact && <div className="shrink-0 text-xs text-ink-soft">{time}</div>}
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      <SidePanel open={selected !== null} onClose={() => setSelected(null)} title={selected ? summary(t, selected, true) : "Activity"}>
        {selected && <ActivityDetail row={selected} />}
      </SidePanel>
    </>
  );
}

function ActivityDetail({ row }: { row: ActivityRow }) {
  const { t, locale } = useI18n();
  const kind = entityKind(row.entity);
  const Icon = kind.icon;
  const changes = Object.entries(row.changes ?? {});
  const onlyNew = changes.every(([, v]) => !isPair(v) || v[0] === null);

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: t("Action"), value: t(ACTION_LABEL[row.action] ?? row.action) },
    { label: t("Record"), value: t(ENTITY_LABEL[row.entity] ?? row.entity) },
    { label: t("Name or number"), value: row.label || "—" },
    { label: t("By"), value: row.actorName },
    { label: t("Time"), value: fullTime(row.createdAt, locale) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", kind.node)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">{row.label || t(ENTITY_LABEL[row.entity] ?? row.entity)}</p>
          {row.entityId && <p className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{row.entityId}</p>}
        </div>
      </div>

      <dl className="overflow-hidden rounded-card border border-line/70">
        {facts.map((f, i) => (
          <div key={f.label} className={cn("flex items-start justify-between gap-4 px-4 py-2.5 text-sm", i % 2 === 0 && "bg-overlay/[0.02]")}>
            <dt className="text-ink-soft">{f.label}</dt>
            <dd className="max-w-[65%] break-words text-right text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>

      {changes.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t(onlyNew ? "Details" : "Changes")}</p>
          <div className="overflow-hidden rounded-card border border-line/70">
            <table className="w-full table-fixed text-[13px]">
              <thead>
                <tr className="border-b border-line/70 bg-overlay/[0.03] text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="w-[30%] px-3 py-2 font-semibold">{t("Field")}</th>
                  {!onlyNew && <th className="px-3 py-2 font-semibold">{t("Before")}</th>}
                  <th className="px-3 py-2 font-semibold">{t(onlyNew ? "Value" : "After")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {changes.map(([field, v]) => {
                  const pair = isPair(v);
                  const before = pair ? v[0] : null;
                  const after = pair ? v[1] : v;
                  return (
                    <tr key={field} className="align-top">
                      <td className="px-3 py-2 text-ink-soft">{t(fieldName(field))}</td>
                      {!onlyNew && (
                        <td className="break-words px-3 py-2 text-rose-600/80 dark:text-rose-300/70">
                          {pair && before !== null ? <span className="line-through decoration-rose-500/40">{show(before)}</span> : "—"}
                        </td>
                      )}
                      <td className="whitespace-pre-wrap break-words px-3 py-2 text-ink">{show(after)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
