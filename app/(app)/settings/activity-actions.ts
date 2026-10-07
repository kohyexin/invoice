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
