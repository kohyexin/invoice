"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { History, Loader2, Search } from "lucide-react";
import { ActivityList, ENTITY_LABEL, entityKind, type ActivityRow } from "@/components/activity/activity-list";
import { Select } from "@/components/ui/form-controls";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { activityStats, listActivity, type ActivityFilter, type ActivityStats } from "./activity-actions";

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

const chipBase = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all";
const chipActive = "border-brand-500/50 bg-brand-500/10 text-brand-700 ring-1 ring-brand-500/25 dark:text-brand-200";
const chipIdle = "border-line/70 text-ink-soft hover:border-overlay/20 hover:text-ink";

/** Who changed what, newest first, with filters by person, kind of record and text. */
export function ActivityView({ users }: { users: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Omit<ActivityFilter, "cursor">>({});
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(
    (f: Omit<ActivityFilter, "cursor">, cursor?: string) =>
      start(async () => {
        setError(null);
        const res = await listActivity({ ...f, cursor });
        setLoaded(true);
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

  const setEntity = (entity?: string) => setFilter((f) => ({ ...f, entity }));

  return (
    <div className="px-5 pb-5 pt-4">
      <div className="relative mb-5 overflow-hidden rounded-card border border-line/70 bg-gradient-to-br from-brand-500/[0.08] to-violet-500/[0.05] p-5">
        <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600 ring-1 ring-brand-500/25 dark:text-brand-300">
              <History className="h-5 w-5" />
            </span>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Audit trail")}</p>
              <p className="text-sm text-ink-muted">{t("Append-only · Owners and Admins only")}</p>
            </div>
          </div>
          <Stats />
        </div>
      </div>

      <div className="mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setEntity(undefined)} className={cn(chipBase, !filter.entity ? chipActive : chipIdle)}>
            {t("All")}
          </button>
          {ENTITY_FILTERS.map((e) => {
            const Icon = entityKind(e === "setting" ? "setting:company" : e).icon;
            return (
              <button key={e} type="button" onClick={() => setEntity(e)} className={cn(chipBase, filter.entity === e ? chipActive : chipIdle)}>
                <Icon className="h-3.5 w-3.5" />
                {t(e === "setting" ? "Settings lists" : ENTITY_LABEL[e])}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search number, name or person")}
              className="w-full rounded-control border border-overlay/10 bg-overlay/[0.04] py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
            />
          </div>
          <Select value={filter.actorId ?? ""} onChange={(e) => setFilter((f) => ({ ...f, actorId: e.target.value || undefined }))} className="w-auto">
            <option value="">{t("Everyone")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <p className="rounded-card border border-line/70 py-12 text-center text-[13px] text-rose-600 dark:text-rose-300">{t(error)}</p>
      ) : !loaded || (pending && rows.length === 0) ? (
        <StreamSkeleton />
      ) : (
        <>
          <ActivityList rows={rows} empty="No activity matches these filters yet." />
          {next && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={pending}
                onClick={() => load(filter, next)}
                className="inline-flex items-center gap-2 rounded-control border border-overlay/10 bg-overlay/[0.04] px-5 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-overlay/[0.08] hover:text-ink disabled:opacity-60"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Load more")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TALLIES = [
  { key: "created", label: "Created", dot: "bg-emerald-500" },
  { key: "changed", label: "Changed", dot: "bg-brand-500" },
  { key: "deleted", label: "Deleted", dot: "bg-rose-500" },
] as const;

/** Two-week sparkline and tallies; hidden if it can't load. */
function Stats() {
  const { t } = useI18n();
  const [stats, setStats] = useState<ActivityStats | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    activityStats()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats(null));
    return () => {
      alive = false;
    };
  }, []);

  if (stats === null) return null;
  if (stats === undefined) return <div className="hidden h-[52px] w-56 animate-pulse rounded-lg bg-overlay/[0.05] sm:block" />;

  const max = Math.max(1, ...stats.daily.map((d) => d.count));
  return (
    <div className="hidden items-end gap-5 sm:flex">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
          {t("Last {0} days", String(stats.days))} · <span className="tabular-nums text-ink-muted">{stats.total}</span>
        </span>
        <div className="flex h-7 items-end gap-[3px]">
          {stats.daily.map((d) => (
            <div
              key={d.day}
              className="w-1.5 rounded-sm bg-gradient-to-t from-brand-500/40 to-brand-500/80"
              style={{ height: `${Math.max(8, (d.count / max) * 100)}%` }}
              title={`${d.day}: ${d.count}`}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {TALLIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
            <span className="text-[12px] font-medium tabular-nums text-ink">{stats[s.key]}</span>
            <span className="text-[11px] text-ink-soft">{t(s.label)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StreamSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-overlay/10" />
          <div className="h-16 flex-1 rounded-card border border-line/50 bg-overlay/[0.03]" />
        </div>
      ))}
    </div>
  );
}
