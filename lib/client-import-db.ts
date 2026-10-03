import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { clientData, mergeClientDraft, nameKey, toClientDraft } from "@/lib/client-import";

type Db = PrismaClient | Prisma.TransactionClient;

/** Creates or updates clients from Jotform rows (see mergeClientDraft for how
 *  existing clients are updated). */
export async function importClientRows(db: Db, rows: Record<string, unknown>[]) {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const clients = await db.client.findMany({ include: { _count: { select: { invoices: true } } } });
  type Row = (typeof clients)[number];
  const byName = new Map(clients.map((c) => [c.name, c]));
  const byJotform = new Map(clients.filter((c) => c.jotformId).map((c) => [c.jotformId!, c]));
  // Names from the old workbook are in capitals while the form keeps the
  // typed case; when two clients share a key, the one with more invoices wins.
  const byKey = new Map<string, Row>();
  for (const c of clients) {
    const cur = byKey.get(nameKey(c.name));
    if (!cur || c._count.invoices > cur._count.invoices) byKey.set(nameKey(c.name), c);
  }

  for (const row of rows) {
    const draft = toClientDraft(row);
    if (!draft) {
      skipped++;
      continue;
    }
    const existing =
      byName.get(draft.name) ??
      (draft.jotformId ? byJotform.get(draft.jotformId) : undefined) ??
      byKey.get(nameKey(draft.name));
    const owner = draft.jotformId ? byJotform.get(draft.jotformId) : undefined;
    const jotformIdFree = !owner || owner.id === existing?.id;

    if (existing) {
      const saved = await db.client.update({ where: { id: existing.id }, data: mergeClientDraft(existing, draft, jotformIdFree) });
      Object.assign(existing, saved);
      if (saved.jotformId) byJotform.set(saved.jotformId, existing);
      updated++;
    } else {
      const saved = await db.client.create({
        data: { name: draft.name, ...clientData(draft), jotformId: jotformIdFree ? draft.jotformId ?? undefined : undefined },
      });
      const added = { ...saved, _count: { invoices: 0 } };
      byName.set(saved.name, added);
      byKey.set(nameKey(saved.name), added);
      if (saved.jotformId) byJotform.set(saved.jotformId, added);
      created++;
    }
  }
  return { created, updated, skipped };
}
