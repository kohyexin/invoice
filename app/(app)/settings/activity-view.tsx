"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ActivityList, ENTITY_LABEL, type ActivityRow } from "@/components/activity/activity-list";
import { Button } from "@/components/ui/button";
import { Select, fieldClass } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { listActivity, type ActivityFilter } from "./activity-actions";

const ENTITY_FILTERS = [
  "invoice",
  "client",
  "import",
  "cash_entry",
  "statement",
  "statement_line",
  "setting",
  "user",
  "role",
] as const;

/** Who changed what, newest first, with filters by person, kind of record and text. */
export function ActivityView({ users }: { users: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Omit<ActivityFilter, "cursor">>({});
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(
    (f: Omit<ActivityFilter, "cursor">, cursor?: string) =>
      start(async () => {
        setError(null);
        const res = await listActivity({ ...f, cursor });
        if (!res.ok) return setError(res.error);
        setRows((prev) => (cursor ? [...prev, ...res.rows] : res.rows));
        setNext(res.next);
      }),
    []
  );

  useEffect(() => load(filter), [filter, load]);

  // Typing filters after a short pause instead of on every key.
  useEffect(() => {
    const timer = setTimeout(() => setFilter((f) => (f.q === query ? f : { ...f, q: query })), 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="px-5 pb-4">
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Select value={filter.actorId ?? ""} onChange={(e) => setFilter((f) => ({ ...f, actorId: e.target.value || undefined }))} className="w-auto">
          <option value="">{t("Everyone")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select value={filter.entity ?? ""} onChange={(e) => setFilter((f) => ({ ...f, entity: e.target.value || undefined }))} className="w-auto">
          <option value="">{t("All records")}</option>
          {ENTITY_FILTERS.map((e) => (
            <option key={e} value={e}>
              {t(e === "setting" ? "Settings lists" : ENTITY_LABEL[e])}
            </option>
          ))}
        </Select>
        <input
          className={cn(fieldClass, "w-56")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search number, name or person")}
        />
      </div>
      {error && <p className="py-4 text-[13px] text-rose-600 dark:text-rose-300">{t(error)}</p>}
      <ActivityList rows={rows} empty={pending ? "Loading…" : "No activity yet."} />
      {next && (
        <div className="flex justify-center pt-3">
          <Button size="sm" variant="secondary" loading={pending} onClick={() => load(filter, next)}>
            {t("Show more")}
          </Button>
        </div>
      )}
    </div>
  );
}
