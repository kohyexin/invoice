"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Columns3,
  Download,
  Plus,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";

/* ------------------------------------------------------------------ */
/*  Gatehub table standard — open, Stripe-like layout:                 */
/*    1. Toolbar: filter chips + "More filters" (left), Export +       */
/*       Edit columns (right). No per-table search — global ⌘K covers  */
/*       data search.                                                  */
/*    2. Table: borderless frame, hairline rows, sortable headers,     */
/*       optional selection and row actions.                           */
/*    3. Footer: rows-per-page · "Showing X–Y of Z" · Previous/Next.   */
/*       Sticks to the viewport bottom while the table extends past    */
/*       the screen, and settles in place at the end of the page.      */
/*  Column visibility and page size persist per tableId.               */
/* ------------------------------------------------------------------ */

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  /** CSS width for `<col>` — stabilizes header/body alignment across locales. */
  width?: string;
  /** Cell renderer — omit for exportOnly columns. */
  render?: (row: T) => React.ReactNode;
  /** Plain value for sorting + CSV export. Enables the header sort toggle. */
  accessor?: (row: T) => string | number;
  /** Always visible — pinned under "Fixed columns" in Edit columns. */
  fixed?: boolean;
  /** Start hidden — listed under "Available columns". */
  defaultHidden?: boolean;
  /** Always included in CSV export, never rendered in the table. */
  exportOnly?: boolean;
};

export type FilterDef<T> = {
  id: string;
  label: string;
  options: string[];
  match: (row: T, value: string) => boolean;
  /** Tucked behind "More filters" until activated. */
  advanced?: boolean;
};

export function MonoLink({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "font-mono text-[13px] text-brand-600 decoration-brand-500/40 decoration-dotted underline-offset-4 hover:underline dark:text-brand-300",
        className
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------- Persistence --------------------------- */

type TablePrefs = { hidden?: string[]; shown?: string[]; pageSize?: number };

function loadPrefs(tableId: string): TablePrefs {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(`inv-table-${tableId}`) ?? "{}");
  } catch {
    return {};
  }
}

function savePrefs(tableId: string, prefs: TablePrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`inv-table-${tableId}`, JSON.stringify(prefs));
}

/* ----------------------------- Popover ----------------------------- */

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

const popoverClass =
  "absolute z-30 mt-1.5 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-overlay/10 bg-surface/95 shadow-float backdrop-blur-2xl animate-scale-in";

/* --------------------------- Filter chip --------------------------- */

function FilterChip<T>({
  filter,
  value,
  onChange,
}: {
  filter: FilterDef<T>;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3 text-[13px] font-medium transition-colors",
          value
            ? "border-transparent bg-brand-500/10 text-brand-600 dark:text-brand-300"
            : "border-overlay/20 text-ink-muted hover:border-overlay/35 hover:text-ink"
        )}
      >
        {value ? (
          <>
            {t(filter.label)}: {t(value)}
            <span
              role="button"
              aria-label={t("Clear filter")}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setOpen(false);
              }}
              className="-mr-1 flex h-4 w-4 items-center justify-center rounded-full hover:bg-brand-500/20"
            >
              <X className="h-3 w-3" />
            </span>
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            {t(filter.label)}
          </>
        )}
      </button>
      {open && (
        <div className={cn(popoverClass, "left-0 top-full w-44 p-1")}>
          {filter.options.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(selected ? null : option);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-left text-[13px] text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
              >
                {t(option)}
                {selected && <Check className="h-3.5 w-3.5 text-brand" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------- More filters --------------------------- */

function MoreFilters<T>({
  filters,
  onPick,
}: {
  filters: FilterDef<T>[];
  onPick: (filterId: string, value: string) => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-overlay/20 px-3 text-[13px] font-medium text-ink-muted transition-colors hover:border-overlay/35 hover:text-ink"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {t("More filters")}
      </button>
      {open && (
        <div className={cn(popoverClass, "left-0 top-full max-h-72 w-52 overflow-y-auto py-1")}>
          {filters.map((f) => (
            <div key={f.id} className="px-1 pb-1">
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {t(f.label)}
              </p>
              {f.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onPick(f.id, option);
                    setOpen(false);
                  }}
                  className="flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-[13px] text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
                >
                  {t(option)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------- Edit columns ---------------------------- */

function EditColumns<T>({
  columns,
  hiddenKeys,
  onToggle,
}: {
  columns: Column<T>[];
  hiddenKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();

  const fixed = columns.filter((c) => c.fixed && !c.exportOnly);
  const active = columns.filter((c) => !c.fixed && !c.exportOnly && !hiddenKeys.has(c.key));
  const available = columns.filter((c) => !c.fixed && !c.exportOnly && hiddenKeys.has(c.key));

  const section = (label: string, items: Column<T>[], mode: "fixed" | "toggle") =>
    items.length > 0 && (
      <div className="px-1 pb-1">
        <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {t(label)}
        </p>
        {items.map((c) => (
          <label
            key={c.key}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[13px]",
              mode === "fixed"
                ? "cursor-default text-ink-soft"
                : "cursor-pointer text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink"
            )}
          >
            <input
              type="checkbox"
              checked={mode === "fixed" || !hiddenKeys.has(c.key)}
              disabled={mode === "fixed"}
              onChange={() => onToggle(c.key)}
              className="h-3.5 w-3.5 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40 disabled:opacity-50"
            />
            {t(c.header)}
          </label>
        ))}
      </div>
    );

  return (
    <div className="relative" ref={ref}>
      <ToolbarButton icon={Columns3} onClick={() => setOpen((o) => !o)}>
        {t("Edit columns")}
      </ToolbarButton>
      {open && (
        <div className={cn(popoverClass, "right-0 top-full w-56 py-1")}>
          {section("Fixed columns", fixed, "fixed")}
          {section("Active columns", active, "toggle")}
          {section("Available columns", available, "toggle")}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Export ----------------------------- */

function toCsvCell(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv<T>(name: string, columns: Column<T>[], rows: T[]) {
  const exportCols = columns.filter((c) => !c.exportOnly);
  const exportOnlyCols = columns.filter((c) => c.exportOnly);
  const allExportCols = [...exportCols, ...exportOnlyCols];
  const header = allExportCols.map((c) => toCsvCell(c.header)).join(",");
  const body = rows.map((row) =>
    allExportCols
      .map((c) =>
        toCsvCell(
          c.accessor
            ? c.accessor(row)
            : (row as Record<string, unknown>)[c.key] ?? ""
        )
      )
      .join(",")
  );
  const blob = new Blob([[header, ...body].join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------ Table ------------------------------ */

type SortState = { key: string; dir: "asc" | "desc" } | null;

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function DataTable<T>({
  tableId,
  columns,
  rows,
  filters = [],
  selectable = false,
  rowKey,
  rowActions,
  rowClassName,
  exportName,
  defaultPageSize = 10,
  renderMobileCard,
  serverPagination,
  initialFilters,
}: {
  /** Stable id — persists column visibility + page size in localStorage. */
  tableId: string;
  columns: Column<T>[];
  rows: T[];
  filters?: FilterDef<T>[];
  selectable?: boolean;
  rowKey?: (row: T, index: number) => string;
  rowActions?: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  exportName?: string;
  defaultPageSize?: number;
  /** Mobile card mode: below md, rows render as stacked cards built by this
   *  callback (selection + row actions still wrap each card). Without it the
   *  table keeps its horizontal-scroll fallback at every width. */
  renderMobileCard?: (row: T) => React.ReactNode;
  /** Server-driven pagination — rows are pre-sliced; parent owns fetch. */
  serverPagination?: {
    total: number;
    page: number;
    pageSize: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
  /** Filter chips already set on first render, e.g. from the URL. */
  initialFilters?: Record<string, string>;
}) {
  const { locale, t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string | null>>(initialFilters ?? {});
  const [sort, setSort] = useState<SortState>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden && !c.fixed).map((c) => c.key))
  );
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* Restore persisted prefs after mount (SSR-safe). */
  useEffect(() => {
    const prefs = loadPrefs(tableId);
    const keys = new Set(columns.map((c) => c.key));
    setHiddenKeys((base) => {
      const next = new Set(base);
      for (const k of prefs.hidden ?? []) if (keys.has(k)) next.add(k);
      for (const k of prefs.shown ?? []) next.delete(k);
      return next;
    });
    if (prefs.pageSize && PAGE_SIZE_OPTIONS.includes(prefs.pageSize)) {
      setPageSize(prefs.pageSize);
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  function persist(next: { hiddenKeys?: Set<string>; pageSize?: number }) {
    const hidden = next.hiddenKeys ?? hiddenKeys;
    const defaults = new Set(
      columns.filter((c) => c.defaultHidden && !c.fixed).map((c) => c.key)
    );
    savePrefs(tableId, {
      hidden: [...hidden].filter((k) => !defaults.has(k)),
      shown: [...defaults].filter((k) => !hidden.has(k)),
      pageSize: next.pageSize ?? pageSize,
    });
  }

  function toggleColumn(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist({ hiddenKeys: next });
      return next;
    });
  }

  /* ----------------------- filter → sort ----------------------- */

  const filtered = useMemo(() => {
    let out = rows;
    for (const f of filters) {
      const v = filterValues[f.id];
      if (v) out = out.filter((r) => f.match(r, v));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.accessor) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const av = col.accessor!(a);
          const bv = col.accessor!(b);
          if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });
      }
    }
    return out;
  }, [rows, filters, filterValues, sort, columns]);

  const totalPages = serverPagination
    ? Math.max(1, Math.ceil(serverPagination.total / serverPagination.pageSize))
    : Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = serverPagination
    ? Math.min(serverPagination.page, totalPages - 1)
    : Math.min(page, totalPages - 1);
  const start = serverPagination
    ? safePage * serverPagination.pageSize
    : safePage * pageSize;
  const pageRows = serverPagination ? rows : filtered.slice(start, start + pageSize);
  const resultTotal = serverPagination ? serverPagination.total : filtered.length;
  const activePageSize = serverPagination?.pageSize ?? pageSize;

  const visibleColumns = columns.filter(
    (c) => !c.exportOnly && (c.fixed || !hiddenKeys.has(c.key))
  );
  const exportColumns = [
    ...visibleColumns,
    ...columns.filter((c) => c.exportOnly),
  ];
  const hasActiveFilters = Object.values(filterValues).some(Boolean);
  const totalCells =
    visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);

  /* Inline chips: primary filters always; advanced ones once activated. */
  const inlineFilters = filters.filter((f) => !f.advanced || filterValues[f.id]);
  const tuckedFilters = filters.filter((f) => f.advanced && !filterValues[f.id]);

  const keyOf = (row: T, i: number) => (rowKey ? rowKey(row, i) : String(start + i));
  const pageKeys = pageRows.map((r, i) => keyOf(r, i));
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));

  /* ----------------------------- Motion ----------------------------- */

  // Changing the view signature remounts the rows, replaying the staggered
  // entrance animation on filter/sort/page changes.
  const viewKey = useMemo(
    () => JSON.stringify([filterValues, sort, safePage, pageSize]),
    [filterValues, sort, safePage, pageSize]
  );

  // Rows whose identity wasn't present on the previous data set get a brand
  // pulse — e.g. a member that just arrived from an invite. Only meaningful
  // with stable row keys. Bulk changes (>3 new keys) are treated as a view
  // swap (e.g. an external filter), not fresh data, so nothing pulses.
  const seenKeys = useRef<Set<string> | null>(null);
  const freshKeys = useMemo(() => {
    if (!rowKey || !seenKeys.current) return new Set<string>();
    const prev = seenKeys.current;
    const fresh = new Set(rows.map((r, i) => rowKey(r, i)).filter((k) => !prev.has(k)));
    return fresh.size > 3 ? new Set<string>() : fresh;
  }, [rows, rowKey]);
  useEffect(() => {
    if (!rowKey) return;
    seenKeys.current = new Set(rows.map((r, i) => rowKey(r, i)));
  }, [rows, rowKey]);

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageKeys.forEach((k) => next.delete(k));
      else pageKeys.forEach((k) => next.add(k));
      return next;
    });
  }

  function toggleSort(key: string) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function clearAll() {
    setFilterValues({});
    setPage(0);
  }

  function handleExport(onlySelected = false) {
    const exportRows = onlySelected
      ? filtered.filter((r, i) => selected.has(keyOf(r, i)))
      : filtered;
    downloadCsv(exportName ?? tableId, exportColumns, exportRows);
  }

  if (!mounted) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-2/5 animate-pulse rounded-full bg-overlay/[0.05]" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-control bg-overlay/[0.04]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* ------------------------- Toolbar ------------------------- */}
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {inlineFilters.map((f) => (
          <FilterChip
            key={f.id}
            filter={f}
            value={filterValues[f.id] ?? null}
            onChange={(v) => {
              setFilterValues((prev) => ({ ...prev, [f.id]: v }));
              setPage(0);
            }}
          />
        ))}
        {tuckedFilters.length > 0 && (
          <MoreFilters
            filters={tuckedFilters}
            onPick={(filterId, value) => {
              setFilterValues((prev) => ({ ...prev, [filterId]: value }));
              setPage(0);
            }}
          />
        )}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            {t("Clear filters")}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ToolbarButton icon={Download} onClick={() => handleExport()}>
            {t("Export")}
          </ToolbarButton>
          <EditColumns columns={columns} hiddenKeys={hiddenKeys} onToggle={toggleColumn} />
        </div>
      </div>

      {/* ----------------------- Bulk actions ---------------------- */}
      {selectable && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3 rounded-control bg-brand-500/[0.06] px-3 py-2 text-[13px]">
          <span className="font-medium text-ink">{t("{0} selected", selected.size)}</span>
          <button
            type="button"
            onClick={() => handleExport(true)}
            className="font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            {t("Export selected")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-ink-muted hover:text-ink"
          >
            {t("Clear selection")}
          </button>
        </div>
      )}

      {/* -------------------------- Table -------------------------- */}
      <div className={cn("relative overflow-x-auto", renderMobileCard && "hidden md:block")}>
        <table
          key={locale}
          className="tnum w-full min-w-[680px] table-auto border-collapse text-sm"
        >
          <colgroup>
            {selectable && <col style={{ width: 36 }} />}
            {visibleColumns.map((c) => (
              // `width` is treated as a max-width cap (applied on the cell), so
              // columns auto-fit their content: compact ones (status, date)
              // shrink, content-rich ones (name) expand. Only fixed utility
              // columns reserve a hard width here.
              <col key={c.key} />
            ))}
            {rowActions && <col style={{ width: 88 }} />}
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              {selectable && (
                <th className="w-9 py-2.5 pr-3">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePage}
                    aria-label={t("Select all rows")}
                    className="h-3.5 w-3.5 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                  />
                </th>
              )}
              {visibleColumns.map((c) => {
                const sortable = Boolean(c.accessor);
                const isSorted = sort?.key === c.key;
                const headerClass = cn(
                  "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold text-ink-soft first:pl-0 last:pr-0",
                  locale === "zh-CN" ? "normal-case tracking-normal" : "uppercase tracking-wider",
                  c.align === "right"
                    ? "text-right"
                    : c.align === "center"
                      ? "text-center"
                      : "text-left"
                );
                return (
                  <th key={c.key} className={headerClass}>
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn(
                          "group flex w-full items-center gap-1 transition-colors hover:text-ink",
                          locale === "zh-CN" ? "normal-case tracking-normal" : "uppercase tracking-wider",
                          c.align === "right"
                            ? "justify-end"
                            : c.align === "center"
                              ? "justify-center"
                              : "justify-start",
                          isSorted && "text-ink"
                        )}
                      >
                        <span className="truncate">{t(c.header)}</span>
                        {isSorted ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArrowDown className="h-3 w-3 shrink-0" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        )}
                      </button>
                    ) : (
                      <span className="block truncate">{t(c.header)}</span>
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th className="w-[88px] py-2.5 pl-3 text-right">
                  <span className="sr-only">{t("Actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const k = keyOf(row, i);
              return (
                <tr
                  // viewKey prefix remounts rows when the view changes so the
                  // entrance animation replays.
                  key={`${viewKey}:${k}`}
                  style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}
                  className={cn(
                    "border-b border-line/60 transition-colors hover:bg-overlay/[0.03] motion-reduce:animate-none",
                    freshKeys.has(k) ? "animate-row-new" : "animate-row-in",
                    selectable && selected.has(k) && "bg-brand-500/[0.04]",
                    rowClassName?.(row)
                  )}
                >
                  {selectable && (
                    <td className="w-9 py-3 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={() => toggleRow(k)}
                        aria-label={t("Select row")}
                        className="h-3.5 w-3.5 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                      />
                    </td>
                  )}
                  {visibleColumns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-3 py-3 text-ink first:pl-0 last:pr-0",
                        c.align === "right"
                          ? "text-right"
                          : c.align === "center"
                            ? "text-center"
                            : "text-left"
                      )}
                    >
                      <div
                        className="min-w-0"
                        style={c.width ? { maxWidth: c.width } : undefined}
                      >
                        {c.render?.(row)}
                      </div>
                    </td>
                  ))}
                  {rowActions && (
                    <td className="w-[88px] py-3 pl-3 text-right">{rowActions(row)}</td>
                  )}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr className="animate-row-in border-b border-line/60 motion-reduce:animate-none">
                <td colSpan={totalCells} className="py-12 text-center">
                  <SearchX className="mx-auto h-7 w-7 text-ink-soft/60" />
                  <p className="mt-2.5 text-[13px] text-ink-soft">
                    {hasActiveFilters
                      ? t("No results match your filters.")
                      : t("Nothing to show yet.")}
                  </p>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAll}
                      className="mt-2 text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-300"
                    >
                      {t("Clear filters")}
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------------- Mobile card list ---------------------- */}
      {renderMobileCard && (
        <div className="space-y-2 md:hidden">
          {pageRows.map((row, i) => {
            const k = keyOf(row, i);
            return (
              <div
                key={`${viewKey}:${k}`}
                style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}
                className={cn(
                  "flex items-start gap-3 rounded-card border border-line/60 bg-surface/40 p-3 motion-reduce:animate-none",
                  freshKeys.has(k) ? "animate-row-new" : "animate-row-in",
                  selectable && selected.has(k) && "border-brand-500/30 bg-brand-500/[0.04]",
                  rowClassName?.(row)
                )}
              >
                {selectable && (
                  <input
                    type="checkbox"
                    checked={selected.has(k)}
                    onChange={() => toggleRow(k)}
                    aria-label={t("Select row")}
                    className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-overlay/20 bg-overlay/5 text-brand focus:ring-brand/40"
                  />
                )}
                <div className="min-w-0 flex-1">{renderMobileCard(row)}</div>
                {rowActions && <div className="shrink-0">{rowActions(row)}</div>}
              </div>
            );
          })}
          {pageRows.length === 0 && (
            <div className="rounded-card border border-line/60 py-12 text-center">
              <SearchX className="mx-auto h-7 w-7 text-ink-soft/60" />
              <p className="mt-2.5 text-[13px] text-ink-soft">
                {hasActiveFilters
                  ? t("No results match your filters.")
                  : t("Nothing to show yet.")}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-2 text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-300"
                >
                  {t("Clear filters")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------- Footer --------------------------
          sticky bottom-0: pins to the viewport while the table runs
          past the screen, then settles naturally at the end. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-x-5 gap-y-2 bg-canvas/80 px-1 py-3 text-[13px] text-ink-muted backdrop-blur-md">
        <label className="flex items-center gap-2">
          {t("Rows per page")}
          <span className="relative">
            <select
              value={activePageSize}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (serverPagination) {
                  serverPagination.onPageSizeChange(next);
                } else {
                  setPageSize(next);
                  setPage(0);
                  persist({ pageSize: next });
                }
              }}
              className="h-7 appearance-none rounded-control border border-overlay/10 bg-overlay/[0.03] pl-2.5 pr-7 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
          </span>
        </label>
        <span className="tnum">
          {resultTotal === 0
            ? t("No results")
            : t(
                "Showing {0}–{1} of {2} results",
                start + 1,
                Math.min(start + activePageSize, resultTotal),
                resultTotal
              )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PagerButton
            label={t("Previous")}
            disabled={safePage === 0}
            onClick={() => {
              if (serverPagination) serverPagination.onPageChange(Math.max(0, safePage - 1));
              else setPage((p) => Math.max(0, p - 1));
            }}
          />
          <PagerButton
            label={t("Next")}
            disabled={safePage >= totalPages - 1}
            onClick={() => {
              if (serverPagination) {
                serverPagination.onPageChange(Math.min(totalPages - 1, safePage + 1));
              } else {
                setPage((p) => Math.min(totalPages - 1, p + 1));
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Primitives ---------------------------- */

function PagerButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center rounded-full border border-overlay/15 bg-surface/60 px-3.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-overlay/[0.06] hover:text-ink disabled:opacity-40 disabled:hover:bg-surface/60 disabled:hover:text-ink-muted"
    >
      {label}
    </button>
  );
}

function ToolbarButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: React.ElementType;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-control border border-overlay/10 bg-overlay/[0.04] px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-overlay/[0.08]"
    >
      <Icon className="h-3.5 w-3.5 text-ink-muted" />
      {children}
    </button>
  );
}
