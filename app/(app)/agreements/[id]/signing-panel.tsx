"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, CheckCircle2, Circle, Copy, ExternalLink, Eye, Mail, PenLine, RefreshCw, Send, UserRoundPen } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { useCan, useCurrentUser } from "@/components/shell/user-context";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/form-controls";
import { cn } from "@/lib/utils";
import { reassignSigner, resendSignRequest, sendForSignature, voidSigning, type LoggedLink } from "../signing-actions";

function formatDateTime(iso: string) {
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })
    .replace(",", "");
}

export type SigningRole = { key: string; label: string; fields: string[]; name: string; email: string };
export type SigningSigner = {
  id: string;
  roleKey: string;
  roleLabel: string;
  name: string;
  email: string;
  status: "PENDING" | "VIEWED" | "SIGNED";
  openedAt: string | null;
  signedAt: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
};
export type SigningEvent = { id: string; type: string; signer: string; other: string; at: string };
export type AppUser = { name: string; email: string };

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent to {0}",
  resent: "New link sent to {0}",
  viewed: "Opened by {0}",
  signed: "Signed by {0}",
  signed_app: "Signed in the app by {0}",
  reminder: "Reminder sent to {0}",
  reassigned: "Reassigned from {0} to {1}",
  completed: "Signed by everyone",
  voided: "Signing cancelled",
};

export function SigningPanel({
  agreementId,
  status,
  roles,
  signers,
  events,
  appUsers,
}: {
  agreementId: string;
  status: string;
  roles: SigningRole[];
  signers: SigningSigner[];
  events: SigningEvent[];
  /** Suggested when entering signers; an app user can then also sign inside the app. */
  appUsers: AppUser[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const me = useCurrentUser();
  const isMe = (email: string) => email.toLowerCase() === me.email.toLowerCase();
  const userByName = (name: string) => appUsers.find((u) => u.name.toLowerCase() === name.trim().toLowerCase());
  const userByEmail = (email: string) => appUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  const canEdit = useCan("agreements", "EDIT");
  const [form, setForm] = useState(() => roles.map((r) => ({ roleKey: r.key, name: r.name, email: r.email })));
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", email: "", notifyPrevious: true });
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [links, setLinks] = useState<LoggedLink[]>([]);
  const [pending, start] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  const run = (fn: () => Promise<{ ok: true; logged?: LoggedLink[] } | { ok: false; error: string }>, done?: string) => {
    setError(null);
    setNotice(null);
    setLinks([]);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error);
      if (res.logged?.length) setLinks(res.logged);
      else if (done) setNotice(done);
      setEditing(null);
      setConfirmVoid(false);
      router.refresh();
    });
  };

  const send = () =>
    run(async () => {
      const res = await sendForSignature(agreementId, form);
      if (res.ok && res.failed.length) return { ok: false, error: t("Sent, but the email to {0} couldn't be delivered. Send a new link below.", res.failed.join(", ")) };
      return res;
    }, t("Sent. Each signer has their own link by email."));

  const signedCount = signers.filter((s) => s.status === "SIGNED").length;

  return (
    <section className="glass-panel neon-edge rounded-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Signing")}</h2>
        <div className="flex items-center gap-2">
          {signers.length > 0 && <span className="tnum text-[12px] text-ink-soft">{t("{0} of {1} signed", signedCount, signers.length)}</span>}
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
            aria-label={t("Refresh")}
            title={t("Refresh")}
            className="flex h-7 w-7 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {status === "FINALIZED" && roles.length === 0 && (
        <p className="mt-3 text-[13px] text-ink-muted">{t("The template has no signature fields yet. Place Client and Company signatures on the template to send this agreement for signing.")}</p>
      )}

      {status === "FINALIZED" && roles.length > 0 && canEdit && (
        <div className="mt-3 space-y-4">
          <p className="text-[13px] text-ink-muted">{t("Each signer gets their own link by email, all at the same time.")}</p>
          {roles.map((r, i) => (
            <div key={r.key} className="space-y-2">
              <p className="text-[13px] font-medium text-ink">
                {t(r.label)}
                <span className="ml-1.5 font-normal text-ink-soft">· {r.fields.join(", ")}</span>
              </p>
              <input
                value={form[i].name}
                list="signing-user-names"
                onChange={(e) => {
                  const name = e.target.value;
                  const user = userByName(name);
                  setForm((f) => f.map((x, j) => (j === i ? { ...x, name, email: user ? user.email : x.email } : x)));
                }}
                placeholder={t("Signer name")}
                className={fieldClass}
              />
              <input
                type="email"
                value={form[i].email}
                list="signing-user-emails"
                onChange={(e) => {
                  const email = e.target.value;
                  const user = userByEmail(email);
                  setForm((f) => f.map((x, j) => (j === i ? { ...x, email, name: user && !x.name.trim() ? user.name : x.name } : x)));
                }}
                placeholder={t("Email")}
                className={fieldClass}
              />
              {userByEmail(form[i].email) && <p className="text-[12px] text-ink-soft">{t("App user: they can also sign inside the app.")}</p>}
            </div>
          ))}
          <Button onClick={send} loading={pending} className="w-full">
            <Send className="h-4 w-4" />
            {t("Send for signature")}
          </Button>
        </div>
      )}

      {signers.length > 0 && (
        <ul className="mt-3 divide-y divide-line/60">
          {signers.map((s) => (
            <li key={s.id} className="py-2.5 text-[13px]">
              <div className="flex items-start gap-2.5">
                {s.status === "SIGNED" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : s.status === "VIEWED" ? (
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-soft" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    {s.name} <span className="text-ink-soft">· {t(s.roleLabel)}</span>
                  </p>
                  <p className="truncate text-[12px] text-ink-soft">{s.email}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {s.status === "SIGNED"
                      ? t("Signed {0}", formatDateTime(s.signedAt!))
                      : s.status === "VIEWED"
                        ? t("Opened {0}, not signed yet", formatDateTime(s.openedAt!))
                        : t("Not opened yet")}
                    {s.status !== "SIGNED" && s.reminderCount > 0 && ` · ${t("{0} reminder(s)", s.reminderCount)}`}
                  </p>
                </div>
                {status === "SENT" && s.status !== "SIGNED" && isMe(s.email) && (
                  <Link href={`/agreements/${agreementId}/sign`} className="shrink-0">
                    <Button size="sm">
                      <PenLine className="h-4 w-4" />
                      {t("Sign now")}
                    </Button>
                  </Link>
                )}
              </div>
              {status === "SENT" && s.status !== "SIGNED" && canEdit && (
                <div className="ml-6 mt-2">
                  {editing === s.id ? (
                    <div className="space-y-2">
                      <p className="text-[12px] text-ink-muted">{t("Pick who signs instead, or fix the name or email. {0}'s current link stops working; signatures already given stay.", s.name)}</p>
                      <input
                        value={edit.name}
                        list="signing-user-names"
                        onChange={(e) => {
                          const name = e.target.value;
                          const user = userByName(name);
                          setEdit((x) => ({ ...x, name, email: user ? user.email : x.email }));
                        }}
                        placeholder={t("Signer name")}
                        className={cn(fieldClass, "h-9")}
                      />
                      <input
                        type="email"
                        value={edit.email}
                        list="signing-user-emails"
                        onChange={(e) => {
                          const email = e.target.value;
                          const user = userByEmail(email);
                          setEdit((x) => ({ ...x, email, name: user && !x.name.trim() ? user.name : x.name }));
                        }}
                        placeholder={t("Email")}
                        className={cn(fieldClass, "h-9")}
                      />
                      {userByEmail(edit.email) && <p className="text-[12px] text-ink-soft">{t("App user: they can also sign inside the app.")}</p>}
                      {edit.email.trim().toLowerCase() !== s.email && (
                        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                          <input type="checkbox" checked={edit.notifyPrevious} onChange={(e) => setEdit((x) => ({ ...x, notifyPrevious: e.target.checked }))} />
                          {t("Let {0} know they no longer need to sign", s.name)}
                        </label>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => run(() => reassignSigner(s.id, edit), t("Reassigned. A new link was sent to {0}.", edit.email.trim()))} loading={pending}>
                          {t("Reassign and send link")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
                          {t("Cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <button
                        type="button"
                        onClick={() => run(() => resendSignRequest(s.id), t("New link sent to {0}.", s.email))}
                        disabled={pending}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline disabled:opacity-60 dark:text-brand-300"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {t("Resend link")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(s.id);
                          setEdit({ name: s.name, email: s.email, notifyPrevious: true });
                        }}
                        disabled={pending}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline disabled:opacity-60 dark:text-brand-300"
                      >
                        <UserRoundPen className="h-3.5 w-3.5" />
                        {t("Reassign")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {status === "SENT" && canEdit && (
        <div className="mt-3 border-t border-line/60 pt-3">
          {confirmVoid ? (
            <div className="space-y-2">
              <p className="text-[12px] text-ink-muted">{t("Every signing link stops working and signatures given so far are discarded. You can send it again afterwards.")}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={() => run(() => voidSigning(agreementId), t("Signing cancelled."))} loading={pending}>
                  {t("Cancel signing")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmVoid(false)} disabled={pending}>
                  {t("Keep it")}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmVoid(true)}>
              {t("Cancel signing")}
            </Button>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      {notice && <p className="mt-3 text-[13px] text-emerald-600 dark:text-emerald-300">{notice}</p>}
      {links.length > 0 && (
        <div className="mt-3 rounded-control border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px]">
          <p className="text-amber-800 dark:text-amber-200">{t("Email isn't set up on this server, so nothing was sent. Pass each signer their link yourself:")}</p>
          <ul className="mt-2 space-y-1.5">
            {links.map((l) => (
              <li key={l.link} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{l.name}</span>
                <CopyLink link={l.link} />
                <a href={l.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline dark:text-brand-300">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("Open")}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && (
        <>
          <datalist id="signing-user-names">
            {appUsers.map((u) => (
              <option key={u.email} value={u.name}>
                {u.email}
              </option>
            ))}
          </datalist>
          <datalist id="signing-user-emails">
            {appUsers.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
        </>
      )}

      {events.length > 0 && (
        <details className="mt-3 border-t border-line/60 pt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-ink-muted">{t("History")}</summary>
          <ul className="mt-2 space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 text-[12px]">
                <span className="text-ink">{t(EVENT_LABEL[e.type] ?? e.type, e.signer, e.other)}</span>
                <span className="tnum shrink-0 text-ink-soft">{formatDateTime(e.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CopyLink({ link }: { link: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("Copy link"), link);
    }
  };
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline dark:text-brand-300">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("Copied") : t("Copy link")}
    </button>
  );
}
