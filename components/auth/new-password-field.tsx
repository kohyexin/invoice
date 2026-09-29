"use client";

import { useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Label } from "@/components/ui/input";
import { useI18n } from "@/components/i18n/locale-provider";

/** Matches MIN_PASSWORD in lib/passwords.ts. */
export const MIN_PASSWORD_LENGTH = 10;

type Strength = { score: 0 | 1 | 2 | 3; label: string };

function passwordStrength(password: string): Strength {
  if (password.length === 0) return { score: 0, label: "" };
  let variety = 0;
  if (/[a-z]/.test(password)) variety++;
  if (/[A-Z]/.test(password)) variety++;
  if (/\d/.test(password)) variety++;
  if (/[^a-zA-Z\d]/.test(password)) variety++;

  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: "Weak" };
  if (password.length >= 12 && variety >= 3) return { score: 3, label: "Strong" };
  return { score: 2, label: "Good" };
}

const STRENGTH_BAR = ["", "bg-rose-500", "bg-amber-500", "bg-emerald-500"] as const;
const STRENGTH_TEXT = [
  "",
  "text-rose-600 dark:text-rose-400",
  "text-amber-600 dark:text-amber-400",
  "text-emerald-600 dark:text-emerald-400",
] as const;

function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const { score, label } = passwordStrength(password);
  return (
    <div className="mt-2.5" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map((seg) => (
          <span
            key={seg}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-300",
              score >= seg ? STRENGTH_BAR[score] : "bg-overlay/10"
            )}
          />
        ))}
        <span
          className={cn(
            "w-12 text-right text-[11px] font-medium leading-none transition-colors",
            score > 0 ? STRENGTH_TEXT[score] : "text-transparent"
          )}
        >
          {label ? t(label) : "•"}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink/40">
        {password.length < MIN_PASSWORD_LENGTH
          ? t("At least {0} characters.", MIN_PASSWORD_LENGTH)
          : t("Tip: 12+ characters mixing letters, numbers and symbols is strongest.")}
      </p>
    </div>
  );
}

/** Single-entry new password: show/hide, Caps Lock warning, strength meter. */
export function NewPasswordField({
  id,
  label,
  value,
  onChange,
  inputClassName,
  labelClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputClassName?: string;
  labelClassName?: string;
}) {
  const { t } = useI18n();
  // Starts masked: browsers only offer "Suggest strong password" on type="password".
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  return (
    <div>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          placeholder={t("At least {0} characters", MIN_PASSWORD_LENGTH)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
          className={cn("pr-11", inputClassName)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? t("Hide password") : t("Show password")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
        >
          {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
        </button>
      </div>
      {capsLock && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-600 animate-scale-in dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5" />
          {t("Caps Lock is on.")}
        </p>
      )}
      <StrengthMeter password={value} />
    </div>
  );
}
