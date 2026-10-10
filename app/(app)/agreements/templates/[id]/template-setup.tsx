"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, FileUp, LocateFixed, Redo2, Undo2 } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { PreviewDrawer } from "@/components/invoices/preview-drawer";
import { Button } from "@/components/ui/button";
import { Field, Segmented, fieldClass } from "@/components/ui/form-controls";
import { InfoTip } from "@/components/ui/info-tip";
import type { FieldBox, FieldConfig } from "@/lib/agreements/fields";
import { cn } from "@/lib/utils";
import { deleteTemplate, replaceTemplatePdf, saveTemplate, type TemplateInput } from "../../actions";
import { FieldEditor } from "./field-editor";
import { DefaultInput, MappingSelect, TypeSelect } from "./field-settings";

export function TemplateSetup({
  id,
  initial,
  agreements,
  boxes: initialBoxes,
  version,
}: {
  id: string;
  initial: TemplateInput;
  agreements: number;
  boxes: FieldBox[];
  version: number;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState(initial);
  const [boxes, setBoxes] = useState(initialBoxes);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<{ open: boolean; url: string | null; loading: boolean; error: string | null }>({
    open: false,
    url: null,
    loading: false,
    error: null,
  });

  const [focus, setFocus] = useState<{ name: string; n: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);

  /* Undo/redo over the field setup and layout. Repeated edits of one kind
   * (typing a label, nudging a box) within a second count as one step. */
  type Snapshot = { fields: FieldConfig[]; boxes: FieldBox[] };
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastStep = useRef({ kind: "", at: 0 });
  const [, setHistoryVersion] = useState(0);
  const now = useRef<Snapshot>({ fields: values.fields, boxes });
  now.current = { fields: values.fields, boxes };

  const checkpoint = (kind: string) => {
    const at = Date.now();
    const same = kind === lastStep.current.kind && at - lastStep.current.at < 1000;
    lastStep.current = { kind, at };
    if (same) return;
    past.current = [...past.current.slice(-49), now.current];
    future.current = [];
    setHistoryVersion((n) => n + 1);
  };

  function travel(from: React.MutableRefObject<Snapshot[]>, to: React.MutableRefObject<Snapshot[]>) {
    const snap = from.current.pop();
    if (!snap) return;
    to.current.push(now.current);
    lastStep.current = { kind: "", at: 0 };
    setValues((v) => ({ ...v, fields: snap.fields }));
    setBoxes(snap.boxes);
    setLayoutDirty(true);
    setNotice(null);
    setResetKey((k) => k + 1);
    setHistoryVersion((n) => n + 1);
  }
  const undo = () => travel(past, future);
  const redo = () => travel(future, past);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing || !(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => setValues(initial), [initial]);
  useEffect(() => {
    setBoxes(initialBoxes);
    setLayoutDirty(false);
    past.current = [];
    future.current = [];
    setHistoryVersion((n) => n + 1);
  }, [initialBoxes]);
  useEffect(() => () => void (preview.url && URL.revokeObjectURL(preview.url)), [preview.url]);

  const placed = new Map<string, number>();
  for (const b of boxes) placed.set(b.pdfFieldName, (placed.get(b.pdfFieldName) ?? 0) + 1);
  const edited = () => {
    setNotice(null);
    setLayoutDirty(true);
  };

  /* A type or options change re-creates the field in the PDF, so it counts as a layout change. */
  const setFieldByName = (name: string, patch: Partial<FieldConfig>) => {
    checkpoint(`field:${name}:${Object.keys(patch).join()}`);
    setNotice(null);
    if ((patch.type || patch.options) && boxes.some((b) => b.pdfFieldName === name)) setLayoutDirty(true);
    setValues((v) => ({ ...v, fields: v.fields.map((f) => (f.pdfFieldName === name ? { ...f, ...patch } : f)) }));
  };
  const setField = (i: number, patch: Partial<FieldConfig>) => setFieldByName(values.fields[i]?.pdfFieldName ?? "", patch);

  const dirty = layoutDirty || JSON.stringify(values) !== JSON.stringify(initial);

  /* Leaving with unsaved changes asks first: closing the tab, and in-app links. */
  useEffect(() => {
    if (!dirty) return;
    const message = t("You have unsaved changes to this template. Leave without saving?");
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest("a[href]");
      if (!a || a.getAttribute("target") === "_blank" || a.getAttribute("href")?.startsWith("/api/")) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, t]);

  function addBox(field: FieldConfig | null, box: FieldBox) {
    checkpoint(`add:${Date.now()}`);
    edited();
    if (field) setValues((v) => ({ ...v, fields: [...v.fields, field] }));
    setBoxes((b) => [...b, box]);
  }

  function moveBox(index: number, box: FieldBox) {
    edited();
    setBoxes((b) => b.map((x, i) => (i === index ? box : x)));
  }

  /* Removing a field's last box removes the field. */
  function removeBox(index: number) {
    const name = boxes[index]?.pdfFieldName;
    if (!name) return;
    checkpoint(`remove:${Date.now()}`);
    edited();
    const rest = boxes.filter((_, i) => i !== index);
    setBoxes(rest);
    if (!rest.some((b) => b.pdfFieldName === name)) setValues((v) => ({ ...v, fields: v.fields.filter((f) => f.pdfFieldName !== name) }));
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveTemplate(id, values, layoutDirty ? boxes : undefined);
      if (!res.ok) return setError(res.error);
      setNotice(t("Saved."));
      router.refresh();
    });
  }

  function replace(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const res = await replaceTemplatePdf(id, form);
      if (fileRef.current) fileRef.current.value = "";
      if (!res.ok) return setError(res.error);
      setNotice(t("New PDF uploaded: {0} fields added, {1} removed. Fields with the same name kept their setup.", res.added, res.removed));
      router.refresh();
    });
  }

  function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    start(async () => {
      const res = await deleteTemplate(id);
      if (!res.ok) {
        setConfirmDelete(false);
        return setError(res.error);
      }
      router.push("/agreements/templates");
    });
  }

  async function showFieldNames() {
    setPreview((p) => ({ ...p, open: true, loading: true, error: null }));
    try {
      const res = await fetch("/api/agreements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: id, names: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not render the PDF.");
      const url = URL.createObjectURL(await res.blob());
      setPreview((p) => ({ ...p, url, loading: false }));
    } catch (e) {
      setPreview((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : "Could not render the PDF." }));
    }
  }

  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const defaultTip = (
    <InfoTip label="About defaults">
      <ul className="list-disc space-y-1 pl-4 font-sans">
        <li>{t("What the New agreement form starts with, e.g. 1 for a number or Today for a date.")}</li>
        <li>{t("A formula fills itself in: {DDMMYYYY} prints the agreement date (any mix of DD, MM, YY, YYYY), e.g. SPC-{DDMMYYYY}.")}</li>
        <li>{t("{Field label} prints another field, e.g. {Client name}.")}</li>
        <li>{t("Whoever fills the form can still type over it.")}</li>
      </ul>
    </InfoTip>
  );

  const checkboxClass = "h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40";

  const fieldName = (f: FieldConfig, i: number) => {
    const count = placed.get(f.pdfFieldName) ?? 0;
    return (
      <div className="font-mono text-[12px] text-ink-muted">
        {count > 0 ? (
          <button
            type="button"
            onClick={() => setFocus({ name: f.pdfFieldName, n: Date.now() })}
            title={t("Show on PDF")}
            className="group inline-flex items-start gap-1 text-left hover:text-brand-600 dark:hover:text-brand-300"
          >
            <span className="break-all underline decoration-dotted underline-offset-2">{f.pdfFieldName}</span>
            <LocateFixed className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
          </button>
        ) : (
          <span className="break-all">{f.pdfFieldName}</span>
        )}
        {count > 1 && <p className="mt-0.5 font-sans text-[11px] text-brand-600 dark:text-brand-300">{t("Appears {0}× on the PDF", count)}</p>}
        {f.type === "choice" && count > 0 ? (
          <input
            key={resetKey}
            defaultValue={(f.options ?? []).join(", ")}
            onBlur={(e) => setField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })}
            placeholder={t("Options, separated by commas")}
            className={cn(fieldClass, "mt-1.5 h-8 font-sans text-[12px]")}
          />
        ) : (
          f.options && f.options.length > 0 && <p className="mt-1 font-sans text-[11px] text-ink-soft">{f.options.join(" · ")}</p>
        )}
      </div>
    );
  };

  const requiredBox = (f: FieldConfig, i: number) => (
    <input
      type="checkbox"
      checked={f.required}
      disabled={f.type === "signature" || f.hidden}
      onChange={(e) => setField(i, { required: e.target.checked })}
      className={cn(checkboxClass, "md:mt-2.5")}
    />
  );

  const hiddenBox = (f: FieldConfig, i: number) => (
    <input
      type="checkbox"
      checked={Boolean(f.hidden)}
      onChange={(e) => setField(i, { hidden: e.target.checked || undefined })}
      title={t("Not asked on the form; the PDF keeps whatever the field already says")}
      className={cn(checkboxClass, "md:mt-2.5")}
    />
  );

  return (
    <div className="space-y-6">
      <section className="glass-panel neon-edge rounded-card p-5">
        <h2 className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Template")}</h2>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
          <Field label="Name *">
            <input value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} className={fieldClass} />
          </Field>
          <Field label="Code *">
            <input
              value={values.code}
              onChange={(e) => setValues((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
              className={cn(fieldClass, "font-mono uppercase")}
            />
          </Field>
          <Field label="Status">
            <Segmented
              value={values.active ? "on" : "off"}
              options={[
                { value: "on", label: "Active" },
                { value: "off", label: "Inactive" },
              ]}
              onChange={(v) => setValues((s) => ({ ...s, active: v === "on" }))}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={showFieldNames}>
            <Eye className="h-4 w-4" />
            {t("Show field names on the PDF")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={pending}>
            <FileUp className="h-4 w-4" />
            {t("Upload a new version")}
          </Button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
        </div>
      </section>

      <section id="place-fields" className="scroll-mt-20 glass-panel neon-edge rounded-card p-5">
        <p className="mb-3 rounded-control bg-overlay/[0.05] px-3 py-2 text-[12px] text-ink-soft md:hidden">{t("Setting up templates works best on a larger screen.")}</p>
        <div className="sticky top-16 z-20 -mx-5 mb-4 flex flex-wrap items-center justify-between gap-2 bg-surface/90 px-5 py-2.5 backdrop-blur-xl">
          <h2 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
            {t("Place fields")}
            <InfoTip label="How to place fields">
              <ul className="list-disc space-y-1 pl-4 font-sans">
                <li>{t("Pick a field on the left, then click on the page to place it.")}</li>
                <li>{t("Drag a box to move it, pull its corner to resize, press Delete to remove it.")}</li>
                <li>{t("Boxes snap to other boxes and to lines of text; hold Alt to place freely. Arrow keys nudge a selected box.")}</li>
                <li>{t("Ctrl+Z undoes, Ctrl+Shift+Z redoes.")}</li>
                <li>{t("To show a field in more than one place, pick it again or use the copy button on a selected box. Every place shows the same value.")}</li>
                <li>{t("Blue fields are saved to the client, amber ones belong to the agreement only, violet ones are signatures.")}</li>
              </ul>
            </InfoTip>
          </h2>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => jumpTo("template-fields")}
              className="flex h-8 items-center gap-1 rounded-control px-2 text-[13px] text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
            >
              {t("Fields")}
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <div className="flex">
              <button
                type="button"
                onClick={undo}
                disabled={past.current.length === 0}
                aria-label={t("Undo")}
                title={t("Undo (Ctrl+Z)")}
                className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-30"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={future.current.length === 0}
                aria-label={t("Redo")}
                title={t("Redo (Ctrl+Shift+Z)")}
                className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-30"
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </div>
            {dirty ? (
              <span className="text-[12px] text-amber-700 dark:text-amber-200">{t("Unsaved changes")}</span>
            ) : (
              notice && <span className="text-[12px] text-emerald-600 dark:text-emerald-300">{notice}</span>
            )}
            <Button size="sm" onClick={save} loading={pending} disabled={!dirty}>
              {t("Save changes")}
            </Button>
          </div>
        </div>
        <FieldEditor
          pdfUrl={`/api/agreements/templates/${id}/pdf`}
          version={version}
          fields={values.fields}
          boxes={boxes}
          focus={focus}
          resetKey={resetKey}
          onAdd={addBox}
          onChange={moveBox}
          onRemove={removeBox}
          onFieldChange={setFieldByName}
          onCheckpoint={checkpoint}
        />
      </section>

      <section id="template-fields" className="scroll-mt-20 glass-panel neon-edge rounded-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Fields")}</h2>
          <button
            type="button"
            onClick={() => jumpTo("place-fields")}
            className="flex h-8 items-center gap-1 rounded-control px-2 text-[13px] text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
          >
            {t("Back to PDF")}
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {t("Each fillable field in the PDF, in the order the New agreement form asks for them. Fields that fill a client detail are pre-filled from the client and saved back to it. Signature fields are left for e-signing.")}
        </p>
        {values.fields.length === 0 && <p className="py-8 text-center text-[13px] text-ink-soft">{t("No fields yet. Place them on the PDF above.")}</p>}

        {values.fields.length > 0 && (
          <div className="mt-4 hidden md:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-soft">
                  <th className="py-2 pr-3">{t("PDF field")}</th>
                  <th className="px-3 py-2">{t("Label")}</th>
                  <th className="px-3 py-2">{t("Type")}</th>
                  <th className="px-3 py-2">{t("Fills client")}</th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      {t("Default")}
                      {defaultTip}
                    </span>
                  </th>
                  <th className="px-3 py-2 text-center">{t("Required")}</th>
                  <th className="py-2 pl-3 text-center">{t("Hidden")}</th>
                </tr>
              </thead>
              <tbody>
                {values.fields.map((f, i) => (
                  <tr key={f.pdfFieldName} className={cn("border-b border-line/60 align-top", f.hidden && "opacity-60")}>
                    <td className="max-w-[220px] break-words py-2.5 pr-3">{fieldName(f, i)}</td>
                    <td className="px-3 py-2">
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} className={cn(fieldClass, "h-9")} />
                    </td>
                    <td className="w-40 px-3 py-2">
                      <TypeSelect field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                    </td>
                    <td className="w-56 px-3 py-2">
                      <MappingSelect field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                    </td>
                    <td className="w-48 px-3 py-2">
                      <DefaultInput field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                    </td>
                    <td className="px-3 py-2 text-center">{requiredBox(f, i)}</td>
                    <td className="py-2 pl-3 text-center">{hiddenBox(f, i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 space-y-3 md:hidden">
          {values.fields.map((f, i) => (
            <div key={f.pdfFieldName} className={cn("rounded-card border border-line/70 p-3", f.hidden && "opacity-60")}>
              {fieldName(f, i)}
              <div className="mt-2 grid gap-2">
                <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label={t("Label")} className={cn(fieldClass, "h-9")} />
                <div className="grid grid-cols-2 gap-2">
                  <TypeSelect field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                  <div>
                    <MappingSelect field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                  </div>
                </div>
                {f.type !== "signature" && (
                  <label className="grid gap-1 text-[12px] text-ink-soft">
                    <span className="inline-flex items-center gap-1">
                      {t("Default")}
                      {defaultTip}
                    </span>
                    <DefaultInput field={f} onChange={(patch) => setField(i, patch)} className="h-9" />
                  </label>
                )}
                <div className="flex gap-5 text-[13px] text-ink">
                  <label className="flex items-center gap-2">
                    {requiredBox(f, i)}
                    {t("Required")}
                  </label>
                  <label className="flex items-center gap-2">
                    {hiddenBox(f, i)}
                    {t("Hidden")}
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      <div className="flex items-center gap-2.5">
        <Button onClick={save} loading={pending}>
          {t("Save changes")}
        </Button>
        {notice && <span className="text-[13px] text-emerald-600 dark:text-emerald-300">{notice}</span>}
        <Button variant={confirmDelete ? "danger" : "ghost"} onClick={remove} disabled={pending || agreements > 0} className="ml-auto" title={agreements > 0 ? t("{0} agreements use this template. Set it to inactive instead.", agreements) : undefined}>
          {t(confirmDelete ? "Confirm delete" : "Delete template")}
        </Button>
      </div>

      <PreviewDrawer
        open={preview.open}
        onOpenChange={(open) => setPreview((p) => ({ ...p, open }))}
        url={preview.url}
        loading={preview.loading}
        error={preview.error}
        emptyText="Each field shows its own name, so you can see where it sits on the page."
      />
    </div>
  );
}
