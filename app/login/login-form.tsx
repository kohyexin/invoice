"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { AuthError, AuthShell, EMAIL_RE, authFieldClass } from "@/components/auth/auth-shell";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

const LAST_USED_KEY = "inv-last-login";

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUsed, setLastUsed] = useState(false);

  useEffect(() => setLastUsed(window.localStorage.getItem(LAST_USED_KEY) === "password"), []);

  const emailInvalid = emailTouched && email.length > 0 && !EMAIL_RE.test(email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(email) || password.length === 0) {
      setError("Invalid email address or password.");
      setPassword("");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });
      if (res.ok) {
        window.localStorage.setItem(LAST_USED_KEY, "password");
        const data = (await res.json().catch(() => null)) as { trusted?: boolean } | null;
        // A trusted browser (2FA within 48h) signs straight in.
        if (data?.trusted) window.location.assign("/dashboard");
        else router.push("/verify");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Invalid email address or password.");
      setPassword("");
    } catch {
      setError("Sign-in was interrupted. Please try again.");
    }
    setLoading(false);
  }

  return (
    <AuthShell tagline>
      <div className="animate-fade-in">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-ink">{t("Welcome back")}</h2>
          <p className="mt-1.5 text-sm text-ink/50">{t("Sign in to your {0} workspace.", "STAR SAAS")}</p>
        </div>

        {error && (
          <AuthError>
            <AlertCircle className="h-4 w-4 shrink-0" />
            {/* error holds the English key so it re-translates live */}
            {t(error)}
          </AuthError>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-ink/80">
              {t("Email address")}
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              invalid={emailInvalid}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              aria-invalid={emailInvalid}
              className={authFieldClass}
            />
            {emailInvalid && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{t("Please enter a valid value.")}</p>}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label htmlFor="password" className="mb-0 text-ink/80">
                {t("Password")}
              </Label>
              <Link
                href="/reset"
                className="text-[13px] font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
              >
                {t("Forgot?")}
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder={t("Enter your password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${authFieldClass} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? t("Hide password") : t("Show password")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 pt-0.5 text-sm text-ink/60">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
            />
            {t("Remember me on this device")}
          </label>

          <div className="relative">
            {lastUsed && (
              <span className="pointer-events-none absolute -top-2 right-2 z-10 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm animate-fade-in dark:bg-brand-500">
                {t("Last used")}
              </span>
            )}
            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? t("Verifying…") : t("Sign in")}
            </Button>
          </div>
        </form>

        <div className="mt-6 flex items-center gap-2.5 rounded-control border border-overlay/10 bg-overlay/[0.03] px-3.5 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/15">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </span>
          <p className="text-xs leading-tight text-ink/55">
            <span className="font-semibold text-ink/90">{t("Enhanced security.")}</span>{" "}
            {t("Two-factor authentication is required on every sign-in.")}
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-ink/50">
          {t("Need an account? Ask an admin to add you.")}
        </p>
      </div>
    </AuthShell>
  );
}
