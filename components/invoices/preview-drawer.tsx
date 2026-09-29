"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Eye, Loader2 } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

/* PDF preview tucked against the right edge. A tab opens it as a drawer;
 * a click anywhere outside it, Esc or Hide tucks it away again. */
export function PreviewDrawer({
  open,
  onOpenChange,
  url,
  loading,
  error,
  emptyText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  loading: boolean;
  error: string | null;
  emptyText: string;
}) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange]);

  if (!mounted) return null;

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label={t("Show preview")}
        aria-expanded={open}
        className={cn(
          "glass-panel fixed right-0 top-1/2 z-[55] flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-card border border-r-0 border-line px-2 py-4 text-ink-muted shadow-float transition-all hover:text-ink",
          open ? "pointer-events-none translate-x-full opacity-0" : "translate-x-0 opacity-100"
        )}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] [writing-mode:vertical-rl]">{t("Preview")}</span>
        {url && !loading && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />}
      </button>

      <aside
        ref={panelRef}
        role="complementary"
        aria-label={t("Invoice preview")}
        aria-hidden={!open}
        className={cn(
          "glass-panel fixed right-0 top-0 z-[56] flex h-full w-[min(780px,94vw)] flex-col border-l border-line shadow-float transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
            {t("Preview")}
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label={t("Hide preview")}
            className="flex h-8 items-center gap-1 rounded-control px-2 text-[13px] text-ink-soft transition-colors hover:bg-overlay/[0.08] hover:text-ink"
          >
            {t("Hide")}
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="mx-4 mt-3 text-[13px] text-amber-700 dark:text-amber-200">{t(error)}</p>}
        <div className="min-h-0 flex-1 p-3">
          {url ? (
            <iframe src={`${url}#toolbar=0&view=FitH`} title={t("Invoice preview")} className="h-full w-full rounded-control bg-white" />
          ) : (
            <div className="flex h-full items-center justify-center rounded-control border border-dashed border-overlay/15 px-6 text-center text-[13px] text-ink-soft">
              {t(emptyText)}
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body
  );
}
