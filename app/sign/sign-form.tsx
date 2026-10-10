"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Download, FileSignature, MailX } from "lucide-react";
import { AuthIcon, AuthShell, MidnightBackdrop, authFieldClass } from "@/components/auth/auth-shell";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/components/i18n/locale-provider";
import { SignDocument, type SignBox, type SignPayload } from "@/components/signing/sign-document";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";

/* What a signer sees from the email link: the agreement with their boxes
 * marked, a signature to draw or type, and a confirmation once signed. */

type Info = {
  title: string;
  agreementStatus: string;
  signer: { name: string; email: string; roleLabel: string; status: string };
  others: { roleLabel: string; name: string; signed: boolean }[];
  boxes: SignBox[];
};
type State =
  | { status: "loading" }
  | { status: "invalid"; reason: "invalid" | "expired" | "error" }
  | { status: "ready"; info: Info }
  | { status: "done"; info: Info; completed: boolean };

export function SignForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    fetch(`/api/sign/${token}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return setState({ status: "invalid", reason: res.status === 410 ? "expired" : res.status === 404 ? "invalid" : "error" });
        const info = (await res.json()) as Info;
        if (info.signer.status === "SIGNED" || info.agreementStatus === "COMPLETED") {
          return setState({ status: "done", info, completed: info.agreementStatus === "COMPLETED" });
        }
        if (info.agreementStatus !== "SENT") return setState({ status: "invalid", reason: "invalid" });
        setState({ status: "ready", info });
        fetch(`/api/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view" }) }).catch(
          () => undefined
        );
      })
      .catch(() => setState({ status: "invalid", reason: "error" }));
  }, [token]);

  if (state.status === "loading") {
    return (
      <AuthShell narrow={false}>
        <div className="space-y-4">
          <div className="h-7 w-2/3 animate-pulse rounded bg-overlay/10" />
          <div className="h-4 w-full animate-pulse rounded bg-overlay/10" />
          <div className="h-24 w-full animate-pulse rounded bg-overlay/10" />
        </div>
      </AuthShell>
    );
  }

  if (state.status === "invalid") {
    return (
      <AuthShell narrow={false}>
        <div className="animate-fade-in">
          <AuthIcon tone="warning">
            <MailX className="h-6 w-6" />
          </AuthIcon>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">
            {state.reason === "expired" ? t("This signing link has expired") : state.reason === "error" ? t("Couldn't load the agreement") : t("Signing link not found")}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
            {state.reason === "expired"
              ? t("Ask the sender to send you a new link.")
              : state.reason === "error"
                ? t("Something went wrong on our side. Your link is fine; please try again in a moment.")
                : t("This link is invalid, was replaced by a newer one, or the signing was cancelled. Check your latest email or contact the sender.")}
          </p>
          {state.reason === "error" && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 flex h-11 w-full items-center justify-center rounded-control bg-overlay/[0.06] text-sm font-medium text-ink hover:bg-overlay/10"
            >
              {t("Try again")}
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  if (state.status === "done") {
    const { info, completed } = state;
    return (
      <AuthShell narrow={false}>
        <div className="animate-fade-in">
          <AuthIcon tone="success">
            <CheckCircle2 className="h-6 w-6" />
          </AuthIcon>
          <h2 className="mt-5 text-2xl font-bold tracking-tight text-ink">{completed ? t("Signed by everyone") : t("Thank you for signing")}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink/50">
            {completed
              ? t("{0} is fully signed. A copy has been emailed to every signer.", info.title)
              : t("We'll email you the signed copy of {0} once everyone has signed.", info.title)}
          </p>
          {!completed && info.others.length > 0 && <SignerList others={info.others} />}
          <a
            href={`/api/sign/${token}/pdf?download`}
            className="mt-6 flex h-11 items-center justify-center gap-2 rounded-control bg-overlay/[0.06] text-sm font-medium text-ink hover:bg-overlay/10"
          >
            <Download className="h-4 w-4" />
            {completed ? t("Download signed agreement") : t("Download a copy")}
          </a>
        </div>
      </AuthShell>
    );
  }

  const info = state.info;
  async function sign(payload: SignPayload) {
    const res = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign", ...payload }),
    });
    const body = (await res.json().catch(() => null)) as { completed?: boolean; error?: string } | null;
    if (!res.ok) return body?.error ?? "Something went wrong. Please try again.";
    setState({ status: "done", info, completed: !!body?.completed });
    return null;
  }

  return (
    <main className="midnight-sky relative min-h-screen overflow-hidden text-ink">
      <MidnightBackdrop />
      <header className="relative z-20 mx-auto flex max-w-4xl items-center justify-between px-4 pt-5 sm:px-6">
        <BrandLogo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <section className="glass rounded-2xl p-5 shadow-2xl sm:p-6">
          <div className="flex items-start gap-4">
            <AuthIcon>
              <FileSignature className="h-6 w-6" />
            </AuthIcon>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{t("Please sign {0}", info.title)}</h1>
              <p className="mt-1 text-sm leading-relaxed text-ink/55">
                {t("Signing as {0} ({1}). Read the agreement below, then sign at the bottom of the page.", info.signer.name, t(info.signer.roleLabel))}
              </p>
            </div>
          </div>
          {info.others.length > 0 && <SignerList others={info.others} />}
        </section>

        <SignDocument
          pdfUrl={`/api/sign/${token}/pdf`}
          boxes={info.boxes}
          signerName={info.signer.name}
          panelClass="glass rounded-2xl p-5 shadow-2xl sm:p-6"
          fieldClass={cn("h-11 w-full rounded-control border px-3.5 text-sm focus:outline-none focus:ring-2", authFieldClass)}
          onSubmit={sign}
        />
      </div>
      <footer className="relative z-10 px-4 pb-6 text-center text-xs text-ink/35">
        <p>© {new Date().getFullYear()} Star SaaS Limited</p>
      </footer>
    </main>
  );
}

function SignerList({ others }: { others: Info["others"] }) {
  const { t } = useI18n();
  return (
    <ul className="mt-4 space-y-1.5 text-sm">
      {others.map((o, i) => (
        <li key={i} className="flex items-center gap-2 text-ink-muted">
          {o.signed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Clock className="h-4 w-4 shrink-0 text-ink-soft" />}
          <span className="min-w-0 truncate">
            {t(o.roleLabel)}: {o.name}
          </span>
          <span className="ml-auto shrink-0 text-xs text-ink-soft">{o.signed ? t("Signed") : t("Waiting")}</span>
        </li>
      ))}
    </ul>
  );
}
