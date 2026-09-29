"use client";

import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

/** Night-sky scene: twinkling constellation, shooting stars, glowing horizon. */
export function MidnightBackdrop() {
  return (
    <>
      <div className="midnight-stars pointer-events-none absolute inset-0" />
      <div className="midnight-stars-2 pointer-events-none absolute inset-0" />

      <div
        className="midnight-meteor pointer-events-none"
        style={{ top: "10%", left: "64%", "--meteor-duration": "9s", "--meteor-delay": "1s" } as React.CSSProperties}
      />
      <div
        className="midnight-meteor pointer-events-none"
        style={{ top: "28%", left: "22%", "--meteor-duration": "13s", "--meteor-delay": "5.5s" } as React.CSSProperties}
      />
      <div
        className="midnight-meteor pointer-events-none"
        style={{ top: "5%", left: "36%", "--meteor-duration": "17s", "--meteor-delay": "10s" } as React.CSSProperties}
      />

      {/* Glowing planet-horizon arc cresting the bottom edge */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 overflow-hidden">
        <div className="absolute left-1/2 top-14 h-[200%] w-[160%] -translate-x-1/2 rounded-[100%] border-t border-brand-500/40 bg-gradient-to-b from-brand-500/[0.12] to-transparent shadow-[0_-30px_90px_-24px_rgb(var(--brand-500)/0.5)]" />
      </div>
    </>
  );
}

function FooterStrip() {
  return (
    <footer className="relative z-10 px-4 pb-6 text-center text-xs text-ink/35">
      <p>© {new Date().getFullYear()} Star SaaS Limited</p>
    </footer>
  );
}

/** Centered Midnight layout shared by sign-in, verify and password reset. */
export function AuthShell({
  children,
  tagline,
  narrow = true,
}: {
  children: React.ReactNode;
  tagline?: boolean;
  narrow?: boolean;
}) {
  const { t } = useI18n();
  return (
    <main className="midnight-sky relative min-h-screen overflow-hidden text-ink">
      <MidnightBackdrop />

      <div className="absolute right-5 top-5 z-20 flex items-center gap-1">
        <ThemeToggle />
        <LanguageToggle />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-7 px-6 py-10">
        <BrandLogo size="lg" />
        {tagline && (
          <p className="max-w-sm text-center text-sm leading-relaxed text-ink-muted">
            {t("Client invoices, payments and billing in one ledger.")}
          </p>
        )}
        <div className={cn("glass w-full rounded-2xl p-7 shadow-2xl", narrow ? "max-w-[420px] sm:p-8" : "max-w-[440px] sm:p-9")}>
          {children}
        </div>
      </div>

      <FooterStrip />
    </main>
  );
}

/** Rounded icon tile at the top of verify / reset cards. */
export function AuthIcon({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "success" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex h-12 w-12 items-center justify-center rounded-xl ring-1",
        tone === "brand" && "bg-brand-500/15 text-brand-600 ring-brand-400/20 dark:text-brand-300",
        tone === "success" && "bg-emerald-500/15 text-emerald-600 ring-emerald-400/25 dark:text-emerald-400",
        tone === "warning" && "bg-warning/15 text-amber-600 ring-warning/25 dark:text-amber-400"
      )}
    >
      {children}
    </span>
  );
}

export const authFieldClass =
  "border-overlay/10 bg-overlay/5 text-ink placeholder:text-ink-soft focus:border-brand-400 focus:ring-brand-500/30";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-5 flex items-center gap-2.5 rounded-control border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-600 animate-scale-in dark:text-rose-300"
    >
      {children}
    </div>
  );
}
