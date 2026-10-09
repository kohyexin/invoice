"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { Select, fieldClass } from "@/components/ui/form-controls";
import { CLIENT_KEYS, FEE_PREFIX, FIELD_TYPES, TODAY, type FieldConfig, type FieldType } from "@/lib/agreements/fields";
import { cn } from "@/lib/utils";

/* Field controls shared by the fields table and the selected-box bar. */

const FEE = "__fee__";

export function TypeSelect({ field, onChange, className }: { field: FieldConfig; onChange: (patch: Partial<FieldConfig>) => void; className?: string }) {
  const { t } = useI18n();
  return (
    <Select value={field.type} onChange={(e) => onChange({ type: e.target.value as FieldType })} className={className}>
      {FIELD_TYPES.map((o) => (
        <option key={o.value} value={o.value}>
          {t(o.label)}
        </option>
      ))}
    </Select>
  );
}

/** The field's starting value on the New agreement form. */
export function DefaultInput({ field, onChange, className }: { field: FieldConfig; onChange: (patch: Partial<FieldConfig>) => void; className?: string }) {
  const { t } = useI18n();
  const value = field.default ?? "";
  const set = (v: string) => onChange({ default: v || undefined });
  if (field.type === "signature") return <span className="text-[12px] text-ink-soft">—</span>;
  if (field.type === "date" || field.type === "checkbox" || field.type === "choice") {
    const options =
      field.type === "date"
        ? [
            { value: TODAY, label: t("Today") },
            ...(value && value !== TODAY ? [{ value, label: value }] : []),
          ]
        : field.type === "checkbox"
          ? [{ value: "true", label: t("Ticked") }]
          : (field.options ?? []).map((o) => ({ value: o, label: o }));
    return (
      <Select value={value} onChange={(e) => set(e.target.value)} className={className}>
        <option value="">{t("None")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange({ default: e.target.value || undefined })}
      placeholder={field.type === "number" ? t("e.g. 1") : t("e.g. SPC-{DDMMYYYY}")}
      className={cn(fieldClass, "font-mono text-[12px]", className)}
    />
  );
}

/** Which client detail the field fills; a fee also names its fee schedule entry. */
export function ClientKeySelect({ field, onChange, className }: { field: FieldConfig; onChange: (patch: Partial<FieldConfig>) => void; className?: string }) {
  const { t } = useI18n();
  const isFee = field.clientKey.startsWith(FEE_PREFIX);
  return (
    <>
      <Select
        value={isFee ? FEE : field.clientKey}
        disabled={field.type === "signature"}
        onChange={(e) => onChange({ clientKey: e.target.value === FEE ? `${FEE_PREFIX}${field.label.trim().toUpperCase()}` : e.target.value })}
        className={className}
      >
        <option value="">{t("Agreement only")}</option>
        {CLIENT_KEYS.map((c) => (
          <option key={c.key} value={c.key}>
            {t(c.label)}
          </option>
        ))}
        <option value={FEE}>{t("Fee schedule…")}</option>
      </Select>
      {isFee && (
        <input
          value={field.clientKey.slice(FEE_PREFIX.length)}
          onChange={(e) => onChange({ clientKey: `${FEE_PREFIX}${e.target.value.toUpperCase()}` })}
          placeholder={t("FIELD")}
          title={t("Name of the fee on the client's fee schedule")}
          className={cn(fieldClass, "mt-1.5 font-mono text-[12px] uppercase", className)}
        />
      )}
    </>
  );
}
