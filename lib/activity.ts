import "server-only";
import { prisma } from "@/lib/db";

export type Actor = { id: string; name: string; email: string };
export type Changes = Record<string, [unknown, unknown]>;

/** Never stored: secrets, and bookkeeping that changes on every save. */
const SKIP = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "createdById",
  "updatedById",
  "passwordHash",
  "sessionVersion",
  "totpSecret",
  "totpPendingSecret",
  "emailCodeHash",
  "inviteTokenHash",
  "accessToken",
  "refreshToken",
  "pdf",
  "pdfData",
  "fileData",
]);

/** Dates, Decimals and bytes become plain JSON so they compare and store cleanly. */
function plain(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `[${v.byteLength} bytes]`;
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { toFixed?: unknown }).toFixed === "function") return String(v);
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

/** Fields of `after` whose value differs from `before`, as [before, after]. */
export function diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): Changes {
  const out: Changes = {};
  for (const [key, raw] of Object.entries(after)) {
    if (SKIP.has(key)) continue;
    const a = plain(before?.[key]);
    const b = plain(raw);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = [a, b];
  }
  return out;
}

/** Only the fields worth recording from a whole row (for creates and deletes). */
export function snapshot(row: Record<string, unknown>): Changes {
  return diff({}, Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))));
}

/** Records one change. With `before` and `after`, stores the field diff and
 *  skips the entry when nothing actually changed. Never throws: a failed log
 *  must not undo the change it describes. */
export async function logActivity(
  actor: Actor | null,
  entry: {
    action: string;
    entity: string;
    entityId?: string | null;
    label?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    changes?: Record<string, unknown> | null;
  }
) {
  try {
    const extra = entry.changes && Object.keys(entry.changes).length ? entry.changes : null;
    let changes: Record<string, unknown> | null = extra;
    if (entry.after) {
      const d = entry.action === "create" ? snapshot(entry.after) : diff(entry.before, entry.after);
      if (entry.action === "update" && Object.keys(d).length === 0 && !extra) return;
      changes = { ...d, ...extra };
    } else if (entry.before && entry.action === "delete") {
      changes = { ...snapshot(entry.before), ...extra };
    }
    await prisma.activityLog.create({
      data: {
        actorId: actor?.id ?? null,
        actorName: actor ? actor.name || actor.email : "System",
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        label: (entry.label ?? "").slice(0, 200),
        changes: changes && Object.keys(changes).length ? (changes as object) : undefined,
      },
    });
  } catch (e) {
    console.error("[activity] could not record", entry.action, entry.entity, e);
  }
}
