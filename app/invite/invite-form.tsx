"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, MailX, UserPlus } from "lucide-react";
import { AuthError, AuthIcon, AuthShell, authFieldClass } from "@/components/auth/auth-shell";
import { MIN_PASSWORD_LENGTH, NewPasswordField } from "@/components/auth/new-password-field";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { roleLabel, type SystemRoleName } from "@/lib/roles";

type InviteState =
  | { status: "loading" }
  | { status: "invalid"; reason: "invalid" | "expired" }
  | { status: "ready"; email: string; role: { name: string; system: SystemRoleName | null } };

export function InviteForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite/${token}`)
      .then(async (res) => {
        if (!res.ok) return setState({ status: "invalid", reason: res.status === 410 ? "expired" : "invalid" });
        const body = (await res.json()) as { email: string; name: string; role: string; roleSystem: SystemRoleName | null };
        setName(body.name);
        setState({ status: "ready", email: body.email, role: { name: body.role, system: body.roleSystem } });
      })
      .catch(() => setState({ status: "invalid", reason: "invalid" }));
  }, [token]);

  const valid = name.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      if (res.ok) {
        const body = (await res.json()) as { email: string };
        window.location.assign(`/login?invited=${encodeURIComponent(body.email)}`);
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
          {state.reason === "expired" ? t("This invitation has expired") : t("Invitation not found")}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
          {state.reason === "expired"
            ? t("Invitations are valid for 72 hours. Ask your admin to send a new one.")
            : t("This invitation is invalid or has already been used. If you've already set your password, sign in.")}
        </p>
        <Link href="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm text-ink/50 hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          {t("Return to sign-in")}
        </Link>
      </div>
    );
  } else {
    content = (
      <div className="animate-fade-in">
        <AuthIcon>
          <UserPlus className="h-6 w-6" />
        </AuthIcon>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{t("Accept your invitation")}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
          {t("You've been invited to join as {0}. Set your name and password for {1}.", roleLabel(t, state.role), state.email)}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
          {error && (
            <AuthError>
              <AlertCircle className="h-4 w-4 shrink-0" />
              {t(error)}
            </AuthError>
          )}
          <div>
            <Label htmlFor="invite-name" className="text-ink/80">
              {t("Your name")}
            </Label>
            <Input
              id="invite-name"
              autoComplete="name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              className={authFieldClass}
            />
          </div>
          <NewPasswordField
            id="invite-password"
            label={t("Password")}
            value={password}
            onChange={setPassword}
            labelClassName="text-ink/80"
            inputClassName={authFieldClass}
          />
          <Button type="submit" size="lg" loading={loading} disabled={!valid} className="w-full">
            {loading ? t("Creating account…") : t("Create account")}
          </Button>
          <p className="text-center text-xs leading-relaxed text-ink/45">
            {t("You'll set up two-factor sign-in the first time you sign in.")}
          </p>
        </form>
      </div>
    );
  }

  return <AuthShell narrow={false}>{content}</AuthShell>;
}
