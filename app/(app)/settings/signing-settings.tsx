"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Field, fieldClass } from "@/components/ui/form-controls";
import type { SigningSettings } from "@/lib/agreements/signing-settings";
import { updateSigningSettings } from "./signing-settings-actions";

/** Body of the Agreement signing tab in Settings. */
export function SigningSettingsForm({ settings, canEdit }: { settings: SigningSettings; canEdit: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [form, setForm] = useState(settings);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);

  const set = <K extends keyof SigningSettings>(key: K, value: SigningSettings[K]) => {
    setMessage(null);
    setForm((f) => ({ ...f, [key]: value }));
  };

  const save = () =>
    start(async () => {
      const res = await updateSigningSettings(form);
      if (!res.ok) return setMessage({ ok: false, text: t(res.error) });
      setMessage({ ok: true, text: t("Saved.") });
      router.refresh();
    });

  const number = (key: "linkDays" | "reminderIntervalDays" | "maxReminders", min: number, max: number) => (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={Number.isNaN(form[key]) ? "" : form[key]}
      disabled={!canEdit}
      onChange={(e) => set(key, e.target.value === "" ? NaN : Number(e.target.value))}
      className={fieldClass}
    />
  );

  return (
    <div className="px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company signer name" hint="Filled in for you when sending an agreement.">
          <input value={form.companySignerName} maxLength={100} disabled={!canEdit} onChange={(e) => set("companySignerName", e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Company signer email">
          <input type="email" value={form.companySignerEmail} disabled={!canEdit} onChange={(e) => set("companySignerEmail", e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Signing link works for (days)" hint="1 to 365 days. Every new link or reminder starts it again.">
          {number("linkDays", 1, 365)}
        </Field>
        <Field label="Remind every (days)" hint="1 to 30 days after sending or the last reminder.">
          {number("reminderIntervalDays", 1, 30)}
        </Field>
        <Field label="Reminders per signer" hint="0 to 20. 0 turns reminders off.">
          {number("maxReminders", 0, 20)}
        </Field>
        <Field label="App address for links" hint="Optional. Leave empty to use the address the app is opened at.">
          <input
            type="url"
            value={form.appUrl}
            placeholder="https://star-invoice.vercel.app"
            disabled={!canEdit}
            onChange={(e) => set("appUrl", e.target.value)}
            className={fieldClass}
          />
        </Field>
      </div>

      {canEdit && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={save} loading={pending} disabled={!dirty}>
            {t("Save")}
          </Button>
          {message && <p className={message.ok ? "text-[13px] text-emerald-600 dark:text-emerald-300" : "text-[13px] text-rose-600 dark:text-rose-300"}>{message.text}</p>}
        </div>
      )}
    </div>
  );
}
