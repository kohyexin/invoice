"use server";

import type { ActivityRow } from "@/components/activity/activity-list";
import { prisma } from "@/lib/db";
import { authorizeManager } from "@/lib/session";

const PAGE = 50;

export type ActivityFilter = { actorId?: string; entity?: string; q?: string; cursor?: string };

/** Newest first, a page at a time. `entity: "setting"` matches every settings list. */
export async function listActivity(filter: ActivityFilter): Promise<{ ok: true; rows: ActivityRow[]; next: string | null } | { ok: false; error: string }> {
  const auth = await authorizeManager();
  if (!auth.ok) return auth;

  const q = filter.q?.trim();
  const rows = await prisma.activityLog.findMany({
    where: {
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.entity === "setting" ? { entity: { startsWith: "setting:" } } : filter.entity ? { entity: filter.entity } : {}),
      ...(q ? { OR: [{ label: { contains: q, mode: "insensitive" } }, { actorName: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  return {
    ok: true,
    rows: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), changes: (r.changes as Record<string, unknown> | null) ?? null })),
    next: rows.length > PAGE ? page[page.length - 1].id : null,
  };
}

const DAYS = 14;
const HK_OFFSET = 8 * 3600_000;

export type ActivityStats = { days: number; daily: { day: string; count: number }[]; created: number; changed: number; deleted: number; total: number };

/** Entries per Hong Kong day over the last two weeks, with tallies by kind of action. */
export async function activityStats(): Promise<ActivityStats | null> {
  const auth = await authorizeManager();
  if (!auth.ok) return null;

  const dayKey = (ms: number) => new Date(ms + HK_OFFSET).toISOString().slice(0, 10);
  const today = Date.parse(`${dayKey(Date.now())}T00:00:00Z`) - HK_OFFSET;
  const since = today - (DAYS - 1) * 86400_000;
  const rows = await prisma.activityLog.findMany({ where: { createdAt: { gte: new Date(since) } }, select: { createdAt: true, action: true } });

  const counts = new Map<string, number>();
  let created = 0;
  let changed = 0;
  let deleted = 0;
  for (const r of rows) {
    const key = dayKey(r.createdAt.getTime());
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (r.action === "create" || r.action === "import") created++;
    else if (r.action === "delete") deleted++;
    else changed++;
  }
  const daily = Array.from({ length: DAYS }, (_, i) => {
    const day = dayKey(since + i * 86400_000);
    return { day, count: counts.get(day) ?? 0 };
  });
  return { days: DAYS, daily, created, changed, deleted, total: rows.length };
}
