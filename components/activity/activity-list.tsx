"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

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

const TONE: Record<string, "success" | "danger" | "warning" | "brand" | "neutral" | "outline"> = {
  create: "success",
  import: "success",
  approve: "success",
  mark_paid: "success",
  delete: "danger",
  reject: "danger",
  update: "brand",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v)) return v.slice(0, 10);
  if (Array.isArray(v)) return v.length ? v.map(show).join("; ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function clip(s: string, n = 120) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function time(iso: string) {
  return `${formatDate(iso)} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Field changes as "field: before → after"; anything else as "field: value". */
function Changes({ changes }: { changes: Record<string, unknown> }) {
  const entries = Object.entries(changes);
  if (!entries.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[12px] text-ink-muted">
      {entries.map(([field, v]) => (
        <li key={field} className="break-words">
          <span className="font-mono text-ink-soft">{field}</span>{" "}
          {Array.isArray(v) && v.length === 2 && v[0] !== null ? (
            <>
              <span className="text-rose-600/80 line-through decoration-rose-500/40 dark:text-rose-300/70">{clip(show(v[0]))}</span>
              {" → "}
              <span className="text-ink">{clip(show(v[1]))}</span>
            </>
          ) : (
            <span className="text-ink">{clip(show(Array.isArray(v) && v.length === 2 && v[0] === null ? v[1] : v), 300)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ActivityList({ rows, showEntity = true, empty = "No activity yet." }: { rows: ActivityRow[]; showEntity?: boolean; empty?: string }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="py-8 text-center text-[13px] text-ink-soft">{t(empty)}</p>;
  return (
    <ol className="divide-y divide-line/60">
      {rows.map((r) => (
        <li key={r.id} className="py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <Badge tone={TONE[r.action] ?? "neutral"}>{t(ACTION_LABEL[r.action] ?? r.action)}</Badge>
            {showEntity && <span className="text-ink-soft">{t(ENTITY_LABEL[r.entity] ?? r.entity)}</span>}
            {r.label && <span className="font-medium text-ink">{r.label}</span>}
            <span className="ml-auto whitespace-nowrap text-[12px] text-ink-soft">
              {r.actorName} · {time(r.createdAt)}
            </span>
          </div>
          {r.changes && <Changes changes={r.changes} />}
        </li>
      ))}
    </ol>
  );
}
