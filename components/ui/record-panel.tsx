"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, fieldClass } from "@/components/ui/form-controls";
import { SidePanel } from "@/components/ui/side-panel";
import type { FieldDef } from "@/lib/settings-config";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

export type Options = Record<string, { value: string; label: string }[]>;

/** Side-panel form driven by field definitions. Values are plain strings,
 *  booleans or numbers; `lines` fields edit a string[] as one row per line. */
export function RecordPanel({
  open,
  title,
  fields,
  initial,
  options = {},
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  title: string;
  fields: FieldDef[];
  initial: Record<string, unknown> | null;
  options?: Options;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const next: Record<string, unknown> = {};
    for (const f of fields) {
      const v = initial?.[f.key];
      if (f.kind === "lines") next[f.key] = Array.isArray(v) ? v.join("\n") : "";
      else if (f.kind === "checkbox") next[f.key] = initial ? Boolean(v) : true;
      else next[f.key] = v ?? "";
    }
    setValues(next);
    setError(null);
    setConfirmDelete(false);
  }, [open, initial, fields]);

  const set = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  function save() {
    start(async () => {
      const err = await onSave(values);
      if (err) setError(err);
      else onClose();
    });
  }

  function remove() {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    start(async () => {
      const err = await onDelete();
      if (err) setError(err);
      else onClose();
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {onDelete && (
            <Button variant={confirmDelete ? "danger" : "ghost"} size="sm" onClick={remove} disabled={pending} className="mr-auto">
              {confirmDelete ? t("Confirm delete") : t("Delete")}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={save} loading={pending}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>
        )}
        {fields.map((f) => {
          const value = values[f.key];
          if (f.kind === "checkbox") {
            return (
              <label key={f.key} className="flex items-center gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => set(f.key, e.target.checked)}
                  className="h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                />
                {t(f.label)}
              </label>
            );
          }
          const label = f.required ? `${f.label} *` : f.label;
          if (f.kind === "select") {
            const opts = f.options ?? (f.optionsFrom ? options[f.optionsFrom] ?? [] : []);
            return (
              <Field key={f.key} label={label} hint={f.hint}>
                <Select value={String(value ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                  {(f.nullable || !f.required) && <option value="">{f.nullable ? t(f.emptyLabel ?? "Any") : "—"}</option>}
                  {!f.nullable && f.required && !value && <option value="">{t("Choose…")}</option>}
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.label)}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          if (f.kind === "lines") {
            return (
              <Field key={f.key} label={label} hint={f.hint}>
                <textarea
                  value={String(value ?? "")}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={3}
                  className={cn(fieldClass, "h-auto py-2 leading-relaxed")}
                />
              </Field>
            );
          }
          return (
            <Field key={f.key} label={label} hint={f.hint}>
              <input
                type={f.kind === "number" ? "number" : "text"}
                step="any"
                value={String(value ?? "")}
                onChange={(e) => set(f.key, e.target.value)}
                className={cn(fieldClass, f.mono && "font-mono")}
              />
            </Field>
          );
        })}
      </div>
    </SidePanel>
  );
}
