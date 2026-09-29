"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { OtpInput } from "@/components/auth/otp-input";
import { useI18n } from "@/components/i18n/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, fieldClass } from "@/components/ui/form-controls";
import { ROLE_HELP, ROLE_LABEL, type RoleName } from "@/lib/roles";
import { formatDate } from "@/lib/utils";
import { changeMyPassword, confirmAuthenticatorChange, startAuthenticatorChange, updateMyName } from "./actions";

type Msg = { tone: "error" | "ok"; text: string } | null;

function Message({ msg }: { msg: NonNullable<Msg> }) {
  const { t } = useI18n();
  return (
    <p
      className={
        msg.tone === "error"
          ? "rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200"
          : "rounded-control border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-700 dark:text-emerald-200"
      }
    >
      {t(msg.text)}
    </p>
  );
}

function Card({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="glass-panel neon-edge rounded-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Icon className="h-4 w-4 text-brand-600 dark:text-brand-300" />
        {t(title)}
      </h2>
      {children}
    </section>
  );
}

export function AccountView({
  name,
  email,
  role,
  totpEnabledAt,
}: {
  name: string;
  email: string;
  role: RoleName;
  totpEnabledAt: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [profileMsg, setProfileMsg] = useState<Msg>(null);
  const [savingName, startName] = useTransition();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [savingPw, startPw] = useTransition();

  function saveName(e: React.FormEvent) {
    e.preventDefault();
    startName(async () => {
      const res = await updateMyName(draftName);
      setProfileMsg(res.ok ? { tone: "ok", text: "Saved." } : { tone: "error", text: res.error });
      if (res.ok) router.refresh();
    });
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setPwMsg({ tone: "error", text: "The new passwords don't match." });
      return;
    }
    startPw(async () => {
      const res = await changeMyPassword(current, next);
      if (!res.ok) {
        setPwMsg({ tone: "error", text: res.error });
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwMsg({ tone: "ok", text: "Password changed. Any other devices have been signed out." });
    });
  }

  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <Card icon={UserRound} title="Profile">
        <form onSubmit={saveName} className="space-y-4">
          {profileMsg && <Message msg={profileMsg} />}
          <Field label="Name" hint="Shown on invoices you create or change.">
            <input className={fieldClass} value={draftName} onChange={(e) => setDraftName(e.target.value)} required />
          </Field>
          <Field label="Email" hint="Ask an admin to change your sign-in email.">
            <input className={fieldClass} value={email} disabled />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink">{t("Role")}</p>
            <div className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Badge tone="brand">{t(ROLE_LABEL[role])}</Badge>
              {t(ROLE_HELP[role])}
            </div>
          </div>
          <Button type="submit" size="sm" loading={savingName} disabled={draftName.trim() === name}>
            {t("Save")}
          </Button>
        </form>
      </Card>

      <Card icon={KeyRound} title="Change password">
        <form onSubmit={savePassword} className="space-y-4">
          {pwMsg && <Message msg={pwMsg} />}
          <Field label="Current password">
            <input
              type="password"
              autoComplete="current-password"
              className={fieldClass}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={10}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              autoComplete="new-password"
              className={fieldClass}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="sm" loading={savingPw}>
            {t("Change password")}
          </Button>
        </form>
      </Card>

      <TwoFactorCard enabledAt={totpEnabledAt} />
    </div>
  );
}

function TwoFactorCard({ enabledAt }: { enabledAt: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "password" | "scan">("idle");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [pending, start] = useTransition();

  function begin(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await startAuthenticatorChange(password);
      if (!res.ok) {
        setMsg({ tone: "error", text: res.error });
        return;
      }
      setPassword("");
      setMsg(null);
      setSetup({ secret: res.secret, qr: res.qr });
      setStep("scan");
    });
  }

  function confirmCode(code: string) {
    start(async () => {
      const res = await confirmAuthenticatorChange(code);
      if (!res.ok) {
        setMsg({ tone: "error", text: res.error });
        setResetKey((k) => k + 1);
        return;
      }
      setStep("idle");
      setSetup(null);
      setMsg({ tone: "ok", text: "Authenticator replaced. Other devices have been signed out." });
      router.refresh();
    });
  }

  function cancel() {
    setStep("idle");
    setSetup(null);
    setPassword("");
    setMsg(null);
  }

  return (
    <div className="lg:col-span-2">
      <Card icon={ShieldCheck} title="Two-factor authentication">
        <div className="space-y-4">
          {msg && <Message msg={msg} />}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-overlay/10 bg-overlay/[0.03] px-3.5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{t("Authenticator app")}</p>
                <p className="text-xs text-ink-muted">
                  {enabledAt ? t("Set up on {0}. Required on every sign-in.", formatDate(enabledAt)) : t("Not set up yet.")}
                </p>
              </div>
            </div>
            {step === "idle" && (
              <Button variant="secondary" size="sm" onClick={() => setStep("password")}>
                {t("Replace authenticator")}
              </Button>
            )}
          </div>

          {step === "password" && (
            <form onSubmit={begin} className="flex max-w-md flex-col gap-3">
              <Field label="Current password" hint="Confirm it's you before changing two-factor.">
                <input
                  type="password"
                  autoComplete="current-password"
                  className={fieldClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={pending}>
                  {t("Continue")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                  {t("Cancel")}
                </Button>
              </div>
            </form>
          )}

          {step === "scan" && setup && (
            <div className="space-y-4">
              <p className="text-sm text-ink-muted">
                {t("Scan the QR code with your new authenticator app, then enter the 6-digit code it shows. Your current authenticator keeps working until you confirm.")}
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <div className="shrink-0 rounded-xl bg-white p-3 shadow-sm ring-1 ring-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qr} alt={t("Authenticator QR code")} className="h-28 w-28" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink-muted">{t("Or enter this key manually")}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <code className="tnum break-all rounded bg-overlay/[0.06] px-2 py-1 text-[12px] text-ink">
                      {setup.secret.replace(/(.{4})/g, "$1 ").trim().toUpperCase()}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(setup.secret);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      aria-label={t("Copy key")}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-overlay/[0.08] hover:text-ink"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="max-w-sm">
                <OtpInput disabled={pending} invalid={msg?.tone === "error"} onComplete={confirmCode} resetKey={resetKey} />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                {t("Cancel")}
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
