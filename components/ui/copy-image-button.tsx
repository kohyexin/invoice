"use client";

import { useState, type RefObject } from "react";
import { toBlob, toPng } from "html-to-image";
import { Camera, Check } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";

type Status = "copied" | "downloaded" | "failed" | null;

/** Copies the referenced node to the clipboard as a PNG, falling back to a download. */
export function CopyImageButton({ target, filename, label = "Copy as image", className }: { target: RefObject<HTMLElement>; filename: string; label?: string; className?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const flash = (s: Status) => {
    setStatus(s);
    window.setTimeout(() => setStatus(null), 2500);
  };

  const capture = async () => {
    const node = target.current;
    if (!node || busy) return;
    setBusy(true);
    const opts = {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(node).backgroundColor,
      style: { position: "static", left: "0", top: "0" },
    };
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        // Safari requires the ClipboardItem to be created synchronously inside the click, with a pending blob.
        const blob = toBlob(node, opts).then((b) => {
          if (!b) throw new Error("empty");
          return b;
        });
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        flash("copied");
      } else {
        throw new Error("no clipboard");
      }
    } catch {
      try {
        const url = await toPng(node, opts);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filename}.png`;
        a.click();
        flash("downloaded");
      } catch {
        flash("failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const message =
    status === "copied"
      ? t("Copied. Paste it into an email or chat.")
      : status === "downloaded"
        ? t("Clipboard unavailable, so the image was downloaded.")
        : status === "failed"
          ? t("Couldn't capture the table.")
          : null;

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      {message && (
        <span className={cn("text-[12px]", status === "failed" ? "text-red-600 dark:text-red-300" : "text-ink-soft")} role="status">
          {message}
        </span>
      )}
      <button
        type="button"
        onClick={capture}
        disabled={busy}
        title={t(label)}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-60"
      >
        {status === "copied" ? <Check className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
        {busy ? t("Capturing…") : t(label)}
      </button>
    </span>
  );
}
