"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Loader2, MousePointerClick, Plus, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Select, fieldClass } from "@/components/ui/form-controls";
import { CLIENT_KEYS, FEE_PREFIX, TODAY, newFieldName, type FieldBox, type FieldConfig, type FieldType } from "@/lib/agreements/fields";
import { cn } from "@/lib/utils";
import { ClientKeySelect, TypeSelect } from "./field-settings";

/* Jotform-style field placement: the template's pages are drawn in the browser,
 * a palette item is picked and dropped onto a page, and boxes can be dragged and
 * resized. Positions are kept in PDF points so they map 1:1 onto the file.
 * Below the lg breakpoint the palette opens as a bottom sheet. */

type PageInfo = { x0: number; y0: number; width: number; height: number; baselines: number[] };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  view: number[];
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: Record<string, unknown>) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: { transform?: number[]; str?: string }[] }>;
};

/** What the next click places. `existing`: another box for a field already on the PDF. */
type Tool = { label: string; type: FieldType; clientKey: string; existing?: string };

const SIZE: Record<FieldType, [number, number]> = {
  text: [170, 16],
  multiline: [260, 44],
  date: [90, 16],
  number: [80, 16],
  checkbox: [11, 11],
  choice: [120, 16],
  signature: [150, 40],
};

const GENERIC: Tool[] = [
  { label: "Text", type: "text", clientKey: "" },
  { label: "Long text", type: "multiline", clientKey: "" },
  { label: "Date", type: "date", clientKey: "" },
  { label: "Number", type: "number", clientKey: "" },
  { label: "Checkbox", type: "checkbox", clientKey: "" },
  { label: "Signature", type: "signature", clientKey: "" },
];
const CLIENT_TOOLS: Tool[] = CLIENT_KEYS.map((c) => ({
  label: c.label,
  type: c.key === "agreementDate" ? "date" : c.key === "address" ? "multiline" : "text",
  clientKey: c.key,
}));
const FEE_TOOL: Tool = { label: "Fee", type: "text", clientKey: FEE_PREFIX };

const ZOOMS = [1, 1.5, 2];
/** How close (in PDF points) an edge must come to snap. */
const SNAP = 3;
/** A field sits this far above the text baseline it lines up with. */
const BASELINE_GAP = 2;

type Drag = { index: number; mode: "move" | "resize"; sx: number; sy: number; box: FieldBox; pxW: number; pxH: number; page: PageInfo };
type Guide = { page: number; x?: number; y?: number };

/** Bigger touch target around a small handle, without making it look bigger. */
const HIT = "before:absolute before:-inset-2.5 before:content-['']";

export function FieldEditor({
  pdfUrl,
  version,
  fields,
  boxes,
  focus,
  resetKey,
  onAdd,
  onChange,
  onRemove,
  onFieldChange,
  onCheckpoint,
}: {
  pdfUrl: string;
  version: number;
  fields: FieldConfig[];
  boxes: FieldBox[];
  /** Scrolls to and selects the field's first box; `n` changes on every request. */
  focus: { name: string; n: number } | null;
  /** Changes when the boxes are replaced wholesale (undo), clearing the selection. */
  resetKey: number;
  /** `field` is null when the box is another place for a field already on the PDF. */
  onAdd: (field: FieldConfig | null, box: FieldBox) => void;
  onChange: (index: number, box: FieldBox) => void;
  onRemove: (index: number) => void;
  onFieldChange: (name: string, patch: Partial<FieldConfig>) => void;
  /** Called before a move or nudge so it can be undone. */
  onCheckpoint: (kind: string) => void;
}) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const drag = useRef<Drag | null>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`${pdfUrl}?v=${version}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load the template PDF.");
        const { getDocumentProxy } = await import("unpdf");
        const pdf = (await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))) as unknown as PdfDoc;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const [x0, y0, x1, y1] = page.view;
          const text = await page.getTextContent().catch(() => ({ items: [] }));
          const baselines = [...new Set(text.items.filter((it) => it.str?.trim() && it.transform).map((it) => Math.round(it.transform![5] * 2) / 2))];
          infos.push({ x0, y0, width: x1 - x0, height: y1 - y0, baselines });
        }
        if (cancelled) return;
        setPages(infos);
        setDoc(pdf);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the template PDF.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, version]);

  useEffect(() => setSelected(null), [resetKey]);

  /* The page crossing the middle of the screen is the current one. */
  useEffect(() => {
    if (!doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.page));
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [doc, pages.length, zoom]);

  useEffect(() => {
    if (!focus) return;
    const index = boxes.findIndex((b) => b.pdfFieldName === focus.name);
    if (index < 0) return;
    setTool(null);
    setSelected(index);
    setFlash(index);
    requestAnimationFrame(() => document.querySelector(`[data-box="${index}"]`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  function goToPage(i: number) {
    pageRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const box = selected !== null ? boxes[selected] : undefined;

  function nudge(dx: number, dy: number) {
    if (selected === null || !box) return;
    const p = pages[box.page];
    if (!p) return;
    onCheckpoint(`nudge:${selected}`);
    onChange(selected, {
      ...box,
      x: clamp(box.x + dx, p.x0, p.x0 + p.width - box.width),
      y: clamp(box.y + dy, p.y0, p.y0 + p.height - box.height),
    });
  }

  function remove(index: number) {
    onRemove(index);
    setSelected(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTool(null);
        setSheetOpen(false);
      }
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (selected === null || typing) return;
      if (e.key === "Delete" || e.key === "Backspace") remove(selected);
      const step = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (arrows[e.key]) {
        e.preventDefault();
        nudge(...arrows[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Lines a moved box up with the other boxes on its page, or with a line of
   *  printed text (sitting just above it). Alt turns snapping off. */
  function snapped(b: FieldBox, index: number, free: boolean): { box: FieldBox; guide: Guide | null } {
    if (free) return { box: b, guide: null };
    const others = boxes.filter((o, i) => i !== index && o.page === b.page);
    const near = (v: number, targets: number[]) => targets.find((c) => Math.abs(v - c) <= SNAP);
    const xs = others.flatMap((o) => [o.x, o.x + o.width]);
    const ys = [...others.flatMap((o) => [o.y, o.y + o.height]), ...(pages[b.page]?.baselines ?? []).map((y) => y - BASELINE_GAP)];
    let { x, y } = b;
    const g: Guide = { page: b.page };
    const left = near(b.x, xs);
    const right = left === undefined ? near(b.x + b.width, xs) : undefined;
    if (left !== undefined) [x, g.x] = [left, left];
    else if (right !== undefined) [x, g.x] = [right - b.width, right];
    const bottom = near(b.y, ys);
    if (bottom !== undefined) [y, g.y] = [bottom, bottom];
    return { box: { ...b, x, y }, guide: g.x !== undefined || g.y !== undefined ? g : null };
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ((e.clientX - d.sx) / d.pxW) * d.page.width;
      const dy = ((e.clientY - d.sy) / d.pxH) * d.page.height;
      const { x0, y0, width: W, height: H } = d.page;
      const b = d.box;
      if (d.mode === "move") {
        const raw = { ...b, x: clamp(b.x + dx, x0, x0 + W - b.width), y: clamp(b.y - dy, y0, y0 + H - b.height) };
        const s = snapped(raw, d.index, e.altKey);
        setGuide(s.guide);
        onChange(d.index, s.box);
      } else {
        const width = clamp(b.width + dx, 6, x0 + W - b.x);
        const height = clamp(b.height + dy, 6, b.y + b.height - y0);
        onChange(d.index, { ...b, width, height, y: b.y + b.height - height });
      }
    };
    const up = () => {
      drag.current = null;
      setGuide(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  const byName = new Map(fields.map((f) => [f.pdfFieldName, f]));
  const placements = (name: string) => boxes.filter((b) => b.pdfFieldName === name).length;
  /** A client detail already on the PDF is placed again rather than added twice. */
  const fieldFor = (x: Tool) =>
    x.existing ?? (x.clientKey && x.clientKey !== FEE_PREFIX ? fields.find((f) => f.clientKey === x.clientKey)?.pdfFieldName : undefined);

  function pick(x: Tool | null) {
    setTool(x);
    setSelected(null);
    setSheetOpen(false);
  }

  function place(pageIndex: number, e: React.PointerEvent<HTMLDivElement>) {
    if (!tool) return setSelected(null);
    const rect = e.currentTarget.getBoundingClientRect();
    const p = pages[pageIndex];
    const existing = fieldFor(tool);
    const like = existing ? boxes.find((b) => b.pdfFieldName === existing) : undefined;
    const [w, h] = like ? [like.width, like.height] : SIZE[tool.type];
    const x = clamp(p.x0 + ((e.clientX - rect.left) / rect.width) * p.width, p.x0, p.x0 + p.width - w);
    const top = p.y0 + p.height - ((e.clientY - rect.top) / rect.height) * p.height;
    const y = clamp(top - h, p.y0, p.y0 + p.height - h);
    const name = existing ?? newFieldName(tool.label, new Set(fields.map((f) => f.pdfFieldName)));
    const clientKey = tool.clientKey === FEE_PREFIX ? `${FEE_PREFIX}${name.toUpperCase()}` : tool.clientKey;
    const placed = snapped({ pdfFieldName: name, page: pageIndex, x, y, width: w, height: h }, -1, e.altKey).box;
    const field: FieldConfig = { pdfFieldName: name, label: name, type: tool.type, required: false, clientKey, default: clientKey === "agreementDate" ? TODAY : undefined };
    onAdd(existing ? null : field, placed);
    setSelected(boxes.length);
    setTool(null);
  }

  function startDrag(e: React.PointerEvent, index: number, mode: Drag["mode"]) {
    if (tool) return;
    e.stopPropagation();
    e.preventDefault();
    const b = boxes[index];
    const overlay = (e.currentTarget as HTMLElement).closest("[data-page]") as HTMLElement;
    const r = overlay.getBoundingClientRect();
    setSelected(index);
    onCheckpoint(`drag:${index}:${Date.now()}`);
    drag.current = { index, mode, sx: e.clientX, sy: e.clientY, box: b, pxW: r.width, pxH: r.height, page: pages[b.page] };
  }

  const toolButton = (x: Tool) => {
    const existing = fieldFor(x);
    const count = existing ? placements(existing) : 0;
    const active = tool?.label === x.label && !tool.existing;
    return (
      <button
        key={x.label}
        type="button"
        onClick={() => pick(active ? null : x)}
        title={count ? t("On the PDF {0}×. Click to place it again; it shows the same value.", count) : undefined}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-2 text-left text-[13px] transition-colors lg:py-1.5",
          active ? "bg-brand text-white" : "text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
        )}
      >
        {t(x.label)}
        {count > 0 && <span className={cn("tnum text-[11px]", active ? "text-white/80" : "text-brand-600 dark:text-brand-300")}>{count}×</span>}
      </button>
    );
  };

  const palette = (
    <>
      <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Client details")}</p>
      {CLIENT_TOOLS.map(toolButton)}
      {toolButton(FEE_TOOL)}
      <p className="mb-1 mt-3 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Agreement only")}</p>
      {GENERIC.map(toolButton)}
    </>
  );

  const field = box ? byName.get(box.pdfFieldName) : undefined;
  const zoomAt = ZOOMS.indexOf(zoom);

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-[7.5rem] lg:block lg:max-h-[calc(100vh-8.5rem)] lg:self-start lg:overflow-y-auto">
        {tool && (
          <p className="mb-2 flex items-start gap-1.5 rounded-control bg-brand-500/10 px-2.5 py-2 text-[12px] text-brand-700 dark:text-brand-200">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("Click where {0} goes · Esc to cancel", t(tool.label))}
          </p>
        )}
        {palette}
      </aside>

      <div className="min-w-0 space-y-3">
        {doc && (
          <div className="sticky top-[7.5rem] z-20 flex items-center gap-2 rounded-control bg-surface/90 py-1 backdrop-blur-xl">
            <Select value={String(current)} onChange={(e) => goToPage(Number(e.target.value))} className="h-8 w-auto text-[13px]" aria-label={t("Go to page")}>
              {pages.map((_, i) => (
                <option key={i} value={i}>
                  {t("Page {0} of {1}", i + 1, pages.length)}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoom(ZOOMS[Math.max(0, zoomAt - 1)])}
                disabled={zoomAt <= 0}
                aria-label={t("Zoom out")}
                className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-40"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title={t("Fit to width")}
                className="tnum h-8 min-w-[52px] rounded-control px-2 text-[12px] text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
              >
                {zoom === 1 ? t("Fit") : `${zoom * 100}%`}
              </button>
              <button
                type="button"
                onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomAt + 1)])}
                disabled={zoomAt >= ZOOMS.length - 1}
                aria-label={t("Zoom in")}
                className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-40"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {loadError && <p className="text-[13px] text-rose-700 dark:text-rose-200">{t(loadError)}</p>}
        {!doc && !loadError && (
          <div className="flex h-64 items-center justify-center text-ink-soft">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {doc && (
          <div className="overflow-x-auto">
            <div className="space-y-4" style={{ width: `${zoom * 100}%` }}>
              {pages.map((p, i) => (
                <div key={`${version}-${i}`}>
                  <p className="mb-1 text-[11px] text-ink-soft">{t("Page {0} of {1}", i + 1, pages.length)}</p>
                  <div
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    data-page={i}
                    onPointerDown={(e) => place(i, e)}
                    className={cn("relative scroll-mt-44 select-none overflow-hidden rounded-control bg-white shadow-float", tool && "cursor-crosshair")}
                    style={{ aspectRatio: `${p.width} / ${p.height}` }}
                  >
                    <PageCanvas doc={doc} index={i} zoom={zoom} />
                    {guide?.page === i && guide.x !== undefined && (
                      <span className="pointer-events-none absolute inset-y-0 w-px bg-pink-500" style={{ left: `${((guide.x - p.x0) / p.width) * 100}%` }} />
                    )}
                    {guide?.page === i && guide.y !== undefined && (
                      <span className="pointer-events-none absolute inset-x-0 h-px bg-pink-500" style={{ top: `${((p.y0 + p.height - guide.y) / p.height) * 100}%` }} />
                    )}
                    {boxes.map((b, index) => {
                      if (b.page !== i) return null;
                      const f = byName.get(b.pdfFieldName);
                      const isSel = selected === index;
                      return (
                        <div
                          key={index}
                          data-box={index}
                          onPointerDown={(e) => startDrag(e, index, "move")}
                          title={f?.label ?? b.pdfFieldName}
                          className={cn(
                            "absolute flex touch-none items-center overflow-visible border text-[10px] leading-none",
                            tool ? "pointer-events-none" : "cursor-move",
                            f?.type === "signature"
                              ? "border-violet-500 bg-violet-500/15 text-violet-800"
                              : f?.clientKey
                                ? "border-brand-500 bg-brand-500/15 text-brand-800"
                                : "border-amber-500 bg-amber-400/20 text-amber-900",
                            isSel && "z-10 ring-2 ring-brand-500 ring-offset-1",
                            flash === index && "animate-pulse ring-4 ring-pink-500 ring-offset-2"
                          )}
                          style={{
                            left: `${((b.x - p.x0) / p.width) * 100}%`,
                            top: `${((p.y0 + p.height - b.y - b.height) / p.height) * 100}%`,
                            width: `${(b.width / p.width) * 100}%`,
                            height: `${(b.height / p.height) * 100}%`,
                          }}
                        >
                          <span className="truncate px-0.5">{f?.type === "checkbox" ? "" : f?.label ?? b.pdfFieldName}</span>
                          {isSel && (
                            <span
                              onPointerDown={(e) => startDrag(e, index, "resize")}
                              className={cn("absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-brand-600", HIT)}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pointer-events-none sticky bottom-3 z-30 flex justify-end">
          {tool ? (
            <div className="glass-panel pointer-events-auto flex w-full items-center gap-2 rounded-card border border-line px-3 py-2 text-[13px] text-ink shadow-float lg:hidden">
              <MousePointerClick className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
              <span className="min-w-0 flex-1">{t("Tap where {0} goes", t(tool.label))}</span>
              <Button size="sm" variant="ghost" onClick={() => setTool(null)}>
                {t("Cancel")}
              </Button>
            </div>
          ) : box && field ? (
            <div className="glass-panel pointer-events-auto w-full rounded-card border border-line p-3 shadow-float">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[160px] flex-1">
                  <span className="mb-1 block text-[11px] text-ink-soft">
                    {t("Label")}
                    {placements(field.pdfFieldName) > 1 && <span className="ml-1.5 text-brand-600 dark:text-brand-300">{t("Appears {0}× on the PDF", placements(field.pdfFieldName))}</span>}
                  </span>
                  <input value={field.label} onChange={(e) => onFieldChange(field.pdfFieldName, { label: e.target.value })} className={cn(fieldClass, "h-9")} />
                </label>
                <label className="w-36">
                  <span className="mb-1 block text-[11px] text-ink-soft">{t("Type")}</span>
                  <TypeSelect field={field} onChange={(patch) => onFieldChange(field.pdfFieldName, patch)} className="h-9" />
                </label>
                <label className="min-w-[160px] flex-1">
                  <span className="mb-1 block text-[11px] text-ink-soft">{t("Fills client")}</span>
                  <ClientKeySelect field={field} onChange={(patch) => onFieldChange(field.pdfFieldName, patch)} className="h-9" />
                </label>
                <label className="flex h-9 items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={field.required}
                    disabled={field.type === "signature"}
                    onChange={(e) => onFieldChange(field.pdfFieldName, { required: e.target.checked })}
                    className="h-4 w-4 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                  />
                  {t("Required")}
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {(
                  [
                    [ArrowLeft, -1, 0, "Move left"],
                    [ArrowUp, 0, 1, "Move up"],
                    [ArrowDown, 0, -1, "Move down"],
                    [ArrowRight, 1, 0, "Move right"],
                  ] as const
                ).map(([Icon, dx, dy, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => nudge(dx, dy)}
                    aria-label={t(label)}
                    title={t("{0} (arrow keys; Shift moves 10)", t(label))}
                    className="flex h-9 w-9 items-center justify-center rounded-control text-ink-muted hover:bg-overlay/[0.06] hover:text-ink"
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-line" />
                <Button size="sm" variant="secondary" onClick={() => pick({ label: field.label, type: field.type, clientKey: field.clientKey, existing: field.pdfFieldName })}>
                  <Copy className="h-4 w-4" />
                  {t("Place again")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => selected !== null && remove(selected)} className="text-rose-600 hover:text-rose-700 dark:text-rose-300">
                  <Trash2 className="h-4 w-4" />
                  {t("Remove")}
                </Button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label={t("Done")}
                  className="ml-auto flex h-9 w-9 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            doc && (
              <Button className="pointer-events-auto shadow-float lg:hidden" onClick={() => setSheetOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("Add field")}
              </Button>
            )
          )}
        </div>
      </div>

      {sheetOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] lg:hidden">
            <div className="absolute inset-0 bg-canvas/60 backdrop-blur-sm animate-fade-in" onClick={() => setSheetOpen(false)} />
            <div className="glass-panel absolute inset-x-0 bottom-0 max-h-[75vh] overflow-y-auto rounded-t-card border-t border-line p-4 pb-8 shadow-float">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{t("Add field")}</p>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label={t("Close")}
                  className="flex h-9 w-9 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {palette}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

/** One page drawn at the container's width (sharp on high-DPI screens, capped to
 *  keep memory in check on long templates); redrawn on zoom. */
function PageCanvas({ doc, index, zoom }: { doc: PdfDoc; index: number; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const pixels = Math.min((canvas.parentElement?.clientWidth ?? base.width) * Math.min(window.devicePixelRatio || 1, 2), 2600);
      const scale = pixels / base.width;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvas, canvasContext: ctx, viewport, annotationMode: 0 });
      await task.promise.catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, zoom]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
