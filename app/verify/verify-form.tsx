"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, Copy, Info, Mail, QrCode, Smartphone } from "lucide-react";
import { AuthIcon, AuthShell } from "@/components/auth/auth-shell";
import { OtpInput } from "@/components/auth/otp-input";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";

type Channel = "app" | "email";

async function postJson(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function enterApp() {
  window.location.assign("/dashboard");
}

/** Opt-in "skip 2FA on this browser for 48 hours". */
function RememberBrowser({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div className="mt-5">
      <label className="flex cursor-pointer items-start justify-center gap-2 text-sm text-ink/60">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
        />
        <span className="inline-flex items-center gap-1.5">
          {t("Remember this browser for 48 hours")}
          <span className="group relative inline-flex">
            <Info className="h-3.5 w-3.5 text-ink/35" />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-60 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-slate-700">
              {t("For the next 48 hours, two-factor authentication won't be required when signing in from this browser. Only use this on a device you trust.")}
            </span>
          </span>
        </span>
      </label>
    </div>
  );
}

function CodeStatus({ error, loading }: { error: string | null; loading: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 min-h-5" aria-live="polite">
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-rose-600 animate-scale-in dark:text-rose-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {t(error)}
        </p>
      )}
      {loading && <p className="text-sm text-ink/50">{t("Verifying code…")}</p>}
    </div>
  );
}

function BackToSignIn() {
  const { t } = useI18n();
  return (
    <Link href="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm text-ink/50 hover:text-ink">
      <ArrowLeft className="h-4 w-4" />
      {t("Return to sign-in")}
    </Link>
  );
}

export function VerifyForm({ needsSetup, maskedEmail }: { needsSetup: boolean; maskedEmail: string }) {
  return <AuthShell narrow={false}>{needsSetup ? <TotpSetup /> : <CodeEntry maskedEmail={maskedEmail} />}</AuthShell>;
}

function CodeEntry({ maskedEmail }: { maskedEmail: string }) {
  const { t } = useI18n();
  const [channel, setChannel] = useState<Channel>("app");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [rememberDevice, setRememberDevice] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleComplete(code: string) {
    setLoading(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/verify", { code, channel, rememberDevice }).catch(() => ({
      ok: false,
      data: {} as Record<string, unknown>,
    }));
    if (ok) return enterApp();
    if (data.restart) return window.location.assign("/login");
    setLoading(false);
    setError(typeof data.error === "string" ? data.error : "Invalid code. Please try again.");
    setResetKey((k) => k + 1);
  }

  async function requestEmailCode() {
    setCooldown(60);
    setNotice(null);
    const { ok, data } = await postJson("/api/auth/email-code").catch(() => ({ ok: false, data: {} as Record<string, unknown> }));
    if (data.restart) return window.location.assign("/login");
    if (!ok) {
      setError(typeof data.error === "string" ? data.error : "Couldn't send the email. Please try again.");
      setCooldown(0);
    } else if (data.mocked) {
      setNotice("Email isn't configured yet, so the code was written to the server console.");
    }
  }

  function switchTo(next: Channel) {
    setChannel(next);
    setError(null);
    setNotice(null);
    setResetKey((k) => k + 1);
    if (next === "email") void requestEmailCode();
  }

  return (
    <div className="animate-fade-in">
      <AuthIcon>{channel === "app" ? <Smartphone className="h-6 w-6" /> : <Mail className="h-6 w-6" />}</AuthIcon>

      <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Verify your identity")}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
        {channel === "app"
          ? t("Enter the 6-digit code from your authenticator app.")
          : t("Enter the 6-digit code we sent to {0}.", maskedEmail)}
      </p>

      <div className="mt-7">
        <OtpInput invalid={Boolean(error)} disabled={loading} onComplete={handleComplete} resetKey={resetKey} />
        <CodeStatus error={error} loading={loading} />
        {notice && <p className="mt-1 text-xs leading-relaxed text-amber-600 dark:text-amber-400">{t(notice)}</p>}
      </div>

      <Button size="lg" loading={loading} className="mt-2 w-full" disabled>
        {t("Continue")}
      </Button>
      <p className="mt-2 text-center text-xs text-ink/40">{t("Code submits automatically once all six digits are entered.")}</p>

      <RememberBrowser checked={rememberDevice} onChange={setRememberDevice} />

      <div className="my-6 h-px bg-overlay/10" />

      {channel === "app" ? (
        <button
          type="button"
          onClick={() => switchTo("email")}
          className="mx-auto block text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {t("Sign in another way")}
        </button>
      ) : (
        <div className="text-center">
          <button
            type="button"
            disabled={cooldown > 0}
            onClick={() => void requestEmailCode()}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 disabled:text-ink/30 dark:text-brand-300 dark:hover:text-brand-200"
          >
            {cooldown > 0 ? t("Resend code in {0}s", cooldown) : t("Resend code")}
          </button>
          <button type="button" onClick={() => switchTo("app")} className="mt-3 block w-full text-sm text-ink/50 hover:text-ink">
            {t("Use authenticator app instead")}
          </button>
        </div>
      )}

      <BackToSignIn />
    </div>
  );
}

/** First sign-in: bind an authenticator app. A live code must verify against
 *  the new secret before it is stored. */
function TotpSetup() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);

  useEffect(() => {
    postJson("/api/auth/totp/setup")
      .then(({ ok, data }) => {
        if (ok) setSetup(data as { secret: string; qr: string });
        else window.location.assign("/login");
      })
      .catch(() => window.location.assign("/login"));
  }, []);

  async function handleComplete(code: string) {
    setLoading(true);
    setError(null);
    const { ok, data } = await postJson("/api/auth/totp/confirm", { code, rememberDevice }).catch(() => ({
      ok: false,
      data: {} as Record<string, unknown>,
    }));
    if (ok) return enterApp();
    if (data.restart) return window.location.assign("/login");
    setLoading(false);
    setError(typeof data.error === "string" ? data.error : "Invalid code. Please try again.");
    setResetKey((k) => k + 1);
  }

  const prettySecret = setup ? setup.secret.replace(/(.{4})/g, "$1 ").trim().toUpperCase() : "";

  return (
    <div className="animate-fade-in">
      <AuthIcon>
        <QrCode className="h-6 w-6" />
      </AuthIcon>

      <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Set up two-factor authentication")}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
        {t(
          "Your account needs an authenticator. Scan the QR code with Google Authenticator, Microsoft Authenticator, 1Password or similar, then confirm with the 6-digit code it shows."
        )}
      </p>

      <div className="mt-6 flex items-center gap-5">
        <div className="shrink-0 rounded-xl bg-white p-3 shadow-sm ring-1 ring-line">
          {setup ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={setup.qr} alt={t("Authenticator QR code")} className="h-28 w-28" />
          ) : (
            <div className="h-28 w-28 animate-pulse rounded bg-slate-200" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-muted">{t("Or enter this key manually")}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="tnum break-all rounded bg-overlay/[0.06] px-2 py-1 text-[12px] text-ink">{prettySecret || "…"}</code>
            <button
              type="button"
              onClick={() => {
                if (!setup) return;
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

      <div className="mt-6">
        <OtpInput invalid={Boolean(error)} disabled={loading || !setup} onComplete={handleComplete} resetKey={resetKey} />
        <CodeStatus error={error} loading={loading} />
      </div>

      <p className="text-center text-xs text-ink/40">{t("Code submits automatically once all six digits are entered.")}</p>

      <RememberBrowser checked={rememberDevice} onChange={setRememberDevice} />

      <BackToSignIn />
    </div>
  );
}
