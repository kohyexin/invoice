"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

export function OtpInput({
  length = 6,
  invalid,
  disabled,
  onComplete,
  resetKey,
}: {
  length?: number;
  invalid?: boolean;
  disabled?: boolean;
  onComplete: (code: string) => void;
  /** Change this value to clear and refocus the inputs (e.g. on error) */
  resetKey?: number;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<string[]>(Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const lastReset = useRef(resetKey);

  if (resetKey !== lastReset.current) {
    lastReset.current = resetKey;
    setValues(Array(length).fill(""));
    queueMicrotask(() => refs.current[0]?.focus());
  }

  function commit(next: string[]) {
    setValues(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  }

  function handleChange(index: number, raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    // Autofill (one-time-code) can drop the whole code into the first box.
    if (digits.length > 1) {
      const next = [...values];
      digits.slice(0, length - index).split("").forEach((d, i) => (next[index + i] = d));
      refs.current[Math.min(index + digits.length, length - 1)]?.focus();
      commit(next);
      return;
    }
    const next = [...values];
    next[index] = digits;
    if (index < length - 1) refs.current[index + 1]?.focus();
    commit(next);
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...values];
      if (next[index]) {
        next[index] = "";
        setValues(next);
      } else if (index > 0) {
        refs.current[index - 1]?.focus();
        next[index - 1] = "";
        setValues(next);
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const next = Array(length).fill("");
    pasted.split("").forEach((d, i) => (next[i] = d));
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
    commit(next);
  }

  return (
    <div className="flex gap-2.5" onPaste={handlePaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={i === 0 ? length : 1}
          disabled={disabled}
          value={values[i]}
          autoFocus={i === 0}
          aria-label={t("Digit {0} of {1}", i + 1, length)}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className={cn(
            "h-14 w-full rounded-control border text-center text-xl font-semibold tabular-nums transition-all",
            "bg-overlay/5 text-ink",
            "focus:outline-none focus:ring-2 focus:ring-offset-0 disabled:opacity-60",
            invalid
              ? "border-danger focus:border-danger focus:ring-danger/25"
              : "border-overlay/10 focus:border-brand-400 focus:ring-brand-500/30",
            values[i] && !invalid && "border-brand-400/60 bg-brand-500/15"
          )}
        />
      ))}
    </div>
  );
}
