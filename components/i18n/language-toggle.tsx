"use client";

import { useState } from "react";
import { Check, Languages } from "lucide-react";
import { LOCALES } from "@/lib/i18n";
import { useI18n } from "./locale-provider";

/** Language switcher for the header and the sign-in screens. */
export function LanguageToggle() {
  const [open, setOpen] = useState(false);
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="relative">
      <button
        aria-label={t("Language")}
        title={t("Language")}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
      >
        <Languages className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1.5 w-44 overflow-hidden rounded-card border border-overlay/10 bg-surface/90 p-1.5 shadow-float backdrop-blur-2xl animate-scale-in">
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {t("Language")}
            </p>
            {LOCALES.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setLocale(l.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
              >
                <span className="flex-1 font-medium">{l.label}</span>
                {locale === l.id && <Check className="h-4 w-4 text-brand" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
