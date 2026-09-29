"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, MailCheck, MailX } from "lucide-react";
import { AuthError, AuthIcon, AuthShell, EMAIL_RE, authFieldClass } from "@/components/auth/auth-shell";
import { MIN_PASSWORD_LENGTH, NewPasswordField } from "@/components/auth/new-password-field";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

function BackToSignIn() {
  const { t } = useI18n();
  return (
    <Link href="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm text-ink/50 hover:text-ink">
      <ArrowLeft className="h-4 w-4" />
      {t("Return to sign-in")}
    </Link>
  );
}

/* /reset — request a reset link */

export function ResetRequestForm() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const invalid = touched && email.length > 0 && !EMAIL_RE.test(email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_RE.test(email)) return;
    setLoading(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    }).catch(() => {});
    // Same confirmation either way, so the page can't reveal who has an account.
    setSentTo(email.trim());
    setLoading(false);
  }

  return (
    <AuthShell narrow={false}>
      {sentTo ? (
        <div className="animate-fade-in">
          <AuthIcon tone="success">
            <MailCheck className="h-6 w-6" />
          </AuthIcon>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Check your email")}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
            {t("If an account exists for {0}, we've sent it a password reset link. The link is valid for 30 minutes.", sentTo)}
          </p>
          <BackToSignIn />
        </div>
      ) : (
        <div className="animate-fade-in">
          <AuthIcon>
            <KeyRound className="h-6 w-6" />
          </AuthIcon>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Reset your password")}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
            {t("Enter the email address for your account and we'll send you a link to reset your password.")}
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <Label htmlFor="reset-email" className="text-ink/80">
                {t("Email address")}
              </Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                invalid={invalid}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                className={authFieldClass}
              />
              {invalid && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{t("Please enter a valid value.")}</p>}
            </div>

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? t("Sending…") : t("Send reset link")}
            </Button>
          </form>

          <BackToSignIn />
        </div>
      )}
    </AuthShell>
  );
}

/* /reset/[token] — choose a new password */

type TokenState = { status: "loading" } | { status: "invalid"; reason: "invalid" | "expired" } | { status: "ready"; email: string } | { status: "done" };

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<TokenState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/reset/${token}`)
      .then(async (res) => {
        if (res.ok) setState({ status: "ready", email: ((await res.json()) as { email: string }).email });
        else setState({ status: "invalid", reason: res.status === 410 ? "expired" : "invalid" });
      })
      .catch(() => setState({ status: "invalid", reason: "invalid" }));
  }, [token]);

  const valid = password.length >= MIN_PASSWORD_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/reset/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setState({ status: "done" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  let content: React.ReactNode;
  if (state.status === "loading") {
    content = (
      <div className="space-y-4">
        <div className="h-7 w-2/3 animate-pulse rounded bg-overlay/10" />
        <div className="h-4 w-full animate-pulse rounded bg-overlay/10" />
        <div className="h-24 w-full animate-pulse rounded bg-overlay/10" />
      </div>
    );
  } else if (state.status === "invalid") {
    content = (
      <div className="animate-fade-in">
        <AuthIcon tone="warning">
          <MailX className="h-6 w-6" />
        </AuthIcon>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
          {state.reason === "expired" ? t("This reset link has expired") : t("Reset link not found")}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
          {state.reason === "expired"
            ? t("Reset links are valid for 30 minutes. Request a new one from the sign-in page.")
            : t("This reset link is invalid or has already been used. Request a new one from the sign-in page.")}
        </p>
        <Link
          href="/reset"
          className="mt-6 flex items-center justify-center text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {t("Request a new link")}
        </Link>
        <BackToSignIn />
      </div>
    );
  } else if (state.status === "done") {
    content = (
      <div className="animate-fade-in">
        <AuthIcon tone="success">
          <CheckCircle2 className="h-6 w-6" />
        </AuthIcon>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Password updated")}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
          {t("Sign in with your new password. You'll still be asked for your two-factor code.")}
        </p>
        <Link href="/login" className="mt-6 block">
          <Button size="lg" className="w-full">
            {t("Sign in")}
          </Button>
        </Link>
      </div>
    );
  } else {
    content = (
      <div className="animate-fade-in">
        <AuthIcon>
          <KeyRound className="h-6 w-6" />
        </AuthIcon>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Set a new password")}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/50">{t("Choose a new password for {0}.", state.email)}</p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          {error && (
            <AuthError>
              <AlertCircle className="h-4 w-4 shrink-0" />
              {t(error)}
            </AuthError>
          )}
          <NewPasswordField
            id="reset-password"
            label={t("New password")}
            value={password}
            onChange={setPassword}
            labelClassName="text-ink/80"
            inputClassName={authFieldClass}
          />
          <Button type="submit" size="lg" loading={loading} disabled={!valid} className="w-full">
            {loading ? t("Resetting…") : t("Reset password")}
          </Button>
        </form>
      </div>
    );
  }

  return <AuthShell narrow={false}>{content}</AuthShell>;
}
