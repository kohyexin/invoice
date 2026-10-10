"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { PreviewDrawer } from "@/components/invoices/preview-drawer";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select, fieldClass } from "@/components/ui/form-controls";
import { clientKeyLabel, isFormula, prefillFromClient, resolveDefault, type ClientDetails, type FieldConfig } from "@/lib/agreements/fields";
import { nameKey } from "@/lib/client-import";
import { cn, toDateInput } from "@/lib/utils";
import { checkAgreementNo, createAgreement } from "../actions";

type Template = { id: string; name: string; code: string; fields: FieldConfig[] };

/** Each field's fixed default (formulas are worked out as the form changes). */
function blankValues(fields: FieldConfig[]) {
  const today = toDateInput(new Date());
  return Object.fromEntries(
    fields.filter((f) => f.default && !isFormula(f.default)).map((f) => [f.pdfFieldName, resolveDefault(f, fields, {}, today)])
  );
}

export function AgreementForm({
  templates,
  clients,
  initialTemplateId,
  initialClientId,
}: {
  templates: Template[];
  clients: ClientDetails[];
  initialTemplateId: string;
  initialClientId: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const initialClient = clients.find((c) => c.id === initialClientId);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const template = templates.find((x) => x.id === templateId);
  const fields = useMemo(() => template?.fields ?? [], [template]);
  const [mode, setMode] = useState<"existing" | "new">(initialClient ? "existing" : "new");
  const [clientQuery, setClientQuery] = useState(initialClient?.name ?? "");
  const [newClientName, setNewClientName] = useState("");
  const client = mode === "existing" ? clients.find((c) => nameKey(c.name) === nameKey(clientQuery)) : undefined;
  const [entered, setValues] = useState<Record<string, string>>(() => ({
    ...blankValues(fields),
    ...(initialClient ? prefillFromClient(fields, initialClient) : {}),
  }));
  /* Formula fields follow the fields they use until someone types in them. */
  const [typedOver, setTypedOver] = useState<Set<string>>(() => new Set());
  const values = useMemo(() => {
    const today = toDateInput(new Date());
    const out = { ...entered };
    for (const f of fields) {
      if (isFormula(f.default) && !typedOver.has(f.pdfFieldName)) out[f.pdfFieldName] = resolveDefault(f, fields, entered, today);
    }
    return out;
  }, [entered, fields, typedOver]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /* Picking a template or client starts the form from that client's details. */
  useEffect(() => {
    setValues((prev) => {
      if (!client) return { ...blankValues(fields), ...prev };
      const fromClient = (name: string) => fields.some((f) => f.pdfFieldName === name && f.clientKey && !f.clientKey.startsWith("agreement"));
      const kept = Object.fromEntries(Object.entries(prev).filter(([name]) => !fromClient(name)));
      return { ...blankValues(fields), ...kept, ...prefillFromClient(fields, client) };
    });
  }, [fields, client]);
  useEffect(() => setTypedOver(new Set()), [fields]);

  const set = (name: string, v: string) => {
    if (fields.some((f) => f.pdfFieldName === name && isFormula(f.default))) setTypedOver((prev) => new Set(prev).add(name));
    setValues((prev) => ({ ...prev, [name]: v }));
  };
  const resetFormula = (name: string) =>
    setTypedOver((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });

  const inputKey = JSON.stringify({ templateId, values });
  useEffect(() => {
    if (!templateId) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/agreements/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: inputKey,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setPreviewError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Preview failed.");
          return;
        }
        const url = URL.createObjectURL(await res.blob());
        setPreviewError(null);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPreviewError("Preview failed.");
      } finally {
        setPreviewing(false);
      }
    }, 900);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [inputKey, templateId]);

  const nameField = fields.find((f) => f.clientKey === "name");
  const numberField = fields.find((f) => f.clientKey === "agreementNo");
  const agreementNo = numberField ? (values[numberField.pdfFieldName] ?? "").trim() : "";
  const [numberClash, setNumberClash] = useState<string | null>(null);
  useEffect(() => {
    setNumberClash(null);
    if (!agreementNo) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const res = await checkAgreementNo(agreementNo, client?.id ?? null).catch(() => null);
      if (!stale && res?.ok) setNumberClash(res.clash);
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [agreementNo, client?.id]);

  function save() {
    setError(null);
    if (mode === "existing" && !client) return setError("Pick a client from the list, or choose New client.");
    if (numberClash) return setError(numberClash);
    start(async () => {
      const res = await createAgreement({ templateId, clientId: client?.id ?? null, newClientName: mode === "new" ? newClientName : "", values });
      if (!res.ok) return setError(res.error);
      router.push(`/agreements/${res.id}`);
    });
  }

  if (templates.length === 0) {
    return (
      <section className="glass-panel neon-edge rounded-card p-8 text-center">
        <p className="text-sm text-ink-muted">{t("There are no active agreement templates yet.")}</p>
        <Link href="/agreements/templates" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
          {t("Set up a template")}
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel neon-edge rounded-card p-5">
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Agreement")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Client">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="shrink-0">
                <Segmented
                  value={mode}
                  options={[
                    { value: "existing", label: "Existing client" },
                    { value: "new", label: "New client" },
                  ]}
                  onChange={setMode}
                />
              </div>
              {mode === "existing" ? (
                <>
                  <input
                    list="agreement-clients"
                    value={clientQuery}
                    onChange={(e) => setClientQuery(e.target.value)}
                    placeholder={t("Search clients")}
                    className={cn(fieldClass, "min-w-0 sm:flex-1")}
                  />
                  <datalist id="agreement-clients">
                    {clients.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </>
              ) : (
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder={nameField ? values[nameField.pdfFieldName] || t("Same as {0}", nameField.label) : t("Client name *")}
                  className={cn(fieldClass, "min-w-0 sm:flex-1")}
                />
              )}
            </div>
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-ink-soft">
          {mode === "existing"
            ? t("The form starts from the client's details. On save, the details you enter here replace the client's, its fees are added to, and a different agreement number goes to its other agreements. The client keeps its name.")
            : t("A new client is created with the details entered here.")}
        </p>
      </section>

      <section className="glass-panel neon-edge rounded-card p-5">
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{template?.name}</h2>
        {fields.length === 0 && <p className="text-[13px] text-ink-soft">{t("This template has no fields to fill in.")}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.pdfFieldName} className={cn(f.type === "multiline" && "sm:col-span-2")}>
              <AgreementField
                field={f}
                value={values[f.pdfFieldName] ?? ""}
                onChange={(v) => set(f.pdfFieldName, v)}
                onReset={isFormula(f.default) && typedOver.has(f.pdfFieldName) ? () => resetFormula(f.pdfFieldName) : undefined}
                problem={f === numberField ? numberClash : null}
              />
            </div>
          ))}
        </div>
      </section>

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      <div className="flex items-center gap-2.5">
        <Button onClick={save} loading={pending}>
          <Save className="h-4 w-4" />
          {t("Save agreement")}
        </Button>
        <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
          {t("Preview")}
        </Button>
      </div>

      <PreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        url={previewUrl}
        loading={previewing}
        error={previewError}
        emptyText="The filled agreement appears here as you type."
      />
    </div>
  );
}

function AgreementField({
  field: f,
  value,
  onChange,
  onReset,
  problem,
}: {
  field: FieldConfig;
  value: string;
  onChange: (v: string) => void;
  /** Set when a formula field was typed over: puts the formula back. */
  onReset?: () => void;
  /** Shown in red under the field, e.g. an agreement number that's already used. */
  problem?: string | null;
}) {
  const { t } = useI18n();
  const label = f.required ? `${f.label} *` : f.label;
  const hint = f.clientKey ? t("Saved to the client: {0}", t(clientKeyLabel(f.clientKey))) : undefined;
  const formula = isFormula(f.default) && (
    <p className="mt-1 text-[12px] text-ink-soft">
      {onReset ? (
        <button type="button" onClick={onReset} className="text-brand-600 hover:underline dark:text-brand-300">
          {t("Use the formula ({0})", f.default ?? "")}
        </button>
      ) : (
        t("Worked out from {0}", f.default ?? "")
      )}
    </p>
  );

  if (f.type === "checkbox") {
    return (
      <label className="flex h-full items-center gap-2.5 pt-6 text-[13px] text-ink">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
          className="h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
        />
        {label}
      </label>
    );
  }
  if (f.clientKey === "address") {
    const lines = [...value.split("\n"), "", "", ""].slice(0, 3);
    return (
      <Field label={label} hint={hint}>
        <div className="grid gap-2">
          {lines.map((line, i) => (
            <input
              key={i}
              value={line}
              onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value.replace(/\n/g, " ") : l)).join("\n"))}
              placeholder={t(`Address line ${i + 1}`)}
              aria-label={t(`Address line ${i + 1}`)}
              className={fieldClass}
            />
          ))}
        </div>
      </Field>
    );
  }

  if (f.clientKey === "websiteUrls") {
    const urls = value ? value.split("\n") : [""];
    const update = (next: string[]) => onChange(next.join("\n"));
    return (
      <Field label={label} hint={hint}>
        <div className="grid gap-2">
          {urls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={url}
                onChange={(e) => update(urls.map((u, j) => (j === i ? e.target.value.replace(/\s/g, "") : u)))}
                placeholder="https://"
                aria-label={t("Website URL {0}", i + 1)}
                className={cn(fieldClass, "min-w-0 flex-1")}
              />
              {urls.length > 1 && (
                <button
                  type="button"
                  onClick={() => update(urls.filter((_, j) => j !== i))}
                  aria-label={t("Remove URL")}
                  className="flex h-10 w-9 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-rose-600 dark:hover:text-rose-300"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => update([...urls, ""])}
            className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("Add URL")}
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={hint}>
      {f.type === "multiline" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={cn(fieldClass, "h-auto py-2")} />
      ) : f.type === "choice" ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <input
          type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(fieldClass, problem && "border-danger/60 focus:border-danger focus:ring-danger/25")}
          aria-invalid={problem ? true : undefined}
        />
      )}
      {formula}
      {problem && <p className="mt-1 text-[12px] text-rose-700 dark:text-rose-300">{t(problem)}</p>}
    </Field>
  );
}
