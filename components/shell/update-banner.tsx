"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";

const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION;
const CHECK_EVERY_MS = 60_000;

/** After a deploy, asks to reload so nobody keeps working on the old version.
 *  They stay logged in; "Later" hides it until the next deploy.
 *  External signers on /sign never see it. */
export function UpdateBanner() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version?: string };
        if (!stopped && version && version !== CURRENT) setLatest(version);
      } catch {
        /* offline: try again later */
      }
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!latest || latest === dismissed || pathname?.startsWith("/sign")) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="glass-panel neon-edge w-full max-w-sm rounded-card p-6 text-center shadow-2xl"
      >
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-600/15 text-brand-500">
          <RefreshCw className="h-5 w-5" />
        </div>
        <h2 id="update-title" className="text-base font-semibold text-ink">
          {t("A new version of Back Office is available.")}
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-soft">
          {t("Reload to get the latest changes. You'll stay signed in.")}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => setDismissed(latest)}
            className="rounded-control px-4 py-2 text-[13px] font-medium text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
          >
            {t("Later")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("Reload")}
          </button>
        </div>
      </div>
    </div>
  );
}
