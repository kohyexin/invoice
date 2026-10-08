"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Click-to-sort for hand-built tables, matching DataTable headers:   */
/*  click once ascending, twice descending, a third time back to the   */
/*  original order.                                                    */
/* ------------------------------------------------------------------ */

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export type SortValue = string | number | null | undefined;

export type SortAccessors<T> = Record<string, (row: T) => SortValue>;

export function nextSort(prev: SortState, key: string): SortState {
  if (prev?.key !== key) return { key, dir: "asc" };
  if (prev.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Empty values (null, undefined, "") always sink to the bottom. */
export function sortRows<T>(rows: T[], sort: SortState, accessors: SortAccessors<T>): T[] {
  const get = sort ? accessors[sort.key] : undefined;
  if (!sort || !get) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    const aEmpty = av === null || av === undefined || av === "";
    const bEmpty = bv === null || bv === undefined || bv === "";
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}

export function useSort<T>(rows: T[], accessors: SortAccessors<T>) {
  const [sort, setSort] = useState<SortState>(null);
  // Accessors are usually inline objects; re-sort on rows/sort changes only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortRows(rows, sort, accessors), [rows, sort]);
  return { sorted, sort, setSort, toggle: (key: string) => setSort((prev) => nextSort(prev, key)) };
}

/** Header button — put inside a `<th>`; inherits the th's text styling. */
export function SortButton({
  sortKey,
  sort,
  onSort,
  children,
  className,
}: {
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "group inline-flex max-w-full items-center gap-1 font-[inherit] transition-colors [letter-spacing:inherit] [text-transform:inherit] hover:text-ink",
        active && "text-ink",
        className
      )}
    >
      <span className="truncate">{children}</span>
      {active ? (
        sort!.dir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}
