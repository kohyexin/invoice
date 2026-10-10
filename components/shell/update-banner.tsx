"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";

const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION;
const CHECK_EVERY_MS = 60_000;

/** After a deploy, offers to reload so nobody keeps working on the old version.
 *  They stay logged in; "Later" hides it until the next deploy. */
export function UpdateBanner() {
  const { t } = useI18n();
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

  if (!latest || latest === dismissed) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="glass-panel neon-edge flex items-center gap-3 rounded-card px-4 py-2.5 text-[13px] shadow-2xl">
        <span className="text-ink">{t("A new version of Back Office is available.")}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-control bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("Reload")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(latest)}
          aria-label={t("Later")}
          title={t("Later")}
          className="flex h-7 w-7 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
