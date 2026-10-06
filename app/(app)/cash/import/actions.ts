"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { authorize } from "@/lib/session";
import { parseStatement } from "@/lib/statements/parse";
import { reconcileStatements, type StatementPreview } from "@/lib/statements/reconcile";
import type { ParsedStatement } from "@/lib/statements/types";

const MAX_FILES = 24;
const MAX_BYTES = 10 * 1024 * 1024;

async function readFiles(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Choose at least one statement PDF.");
  if (files.length > MAX_FILES) throw new Error(`Upload at most ${MAX_FILES} statements at a time.`);
  const parsed: { name: string; statement: ParsedStatement }[] = [];
  const errors: StatementPreview["errors"] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      errors.push({ file: f.name, message: "File is larger than 10 MB." });
      continue;
    }
    try {
      parsed.push({ name: f.name, statement: await parseStatement(new Uint8Array(await f.arrayBuffer())) });
    } catch (e) {
      errors.push({ file: f.name, message: e instanceof Error ? e.message : "Couldn't read this file." });
    }
  }
  // The same statement uploaded twice would double its lines.
  const seen = new Set<string>();
  const unique = parsed.filter((p) => {
    const k = `${p.statement.bank}:${p.statement.accountNumber}:${p.statement.periodStart}`;
    if (seen.has(k)) {
      errors.push({ file: p.name, message: "Same statement as another file in this upload; skipped." });
      return false;
    }
    seen.add(k);
    return true;
  });
  return { parsed: unique, errors };
}

function choicesFrom(form: FormData) {
  try {
    return JSON.parse(String(form.get("choices") ?? "{}")) as ApplyChoices;
  } catch {
    return {} as ApplyChoices;
  }
}

export type ApplyChoices = {
  /** "accountNumber:currency" -> bank account id, for statements not yet linked in Settings. */
  accounts?: Record<string, string>;
  /** Proposed line keys to leave out. */
  excluded?: string[];
  /** Proposed line key -> category id ("" for none). */
  categories?: Record<string, string>;
  /** Account id -> detail field keys to copy from the statement. */
  details?: Record<string, string[]>;
};

export async function previewStatements(form: FormData): Promise<({ ok: true } & StatementPreview) | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    const { parsed, errors } = await readFiles(form);
    const result = await reconcileStatements(parsed, choicesFrom(form).accounts);
    return { ok: true, ...result, errors };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't read the statements." };
  }
}

export async function applyStatements(form: FormData): Promise<{ ok: true; added: number; updatedAccounts: number } | { ok: false; error: string }> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  try {
    const choices = choicesFrom(form);
    const { parsed } = await readFiles(form);
    const preview = await reconcileStatements(parsed, choices.accounts);
    const excluded = new Set(choices.excluded ?? []);
    const categoryIds = new Set((await prisma.cashCategory.findMany({ select: { id: true } })).map((c) => c.id));
    const pickCategory = (key: string, fallback: string) => {
      const chosen = choices.categories?.[key];
      const id = chosen === undefined ? fallback : chosen;
      return id && categoryIds.has(id) ? id : null;
    };

    const lines = preview.months.flatMap((m) => m.proposed).filter((l) => !excluded.has(l.key));
    const seqs = new Map<string, number>();
    for (const accountId of new Set(lines.map((l) => l.accountId))) {
      const max = await prisma.cashTxn.aggregate({ where: { accountId }, _max: { seq: true } });
      seqs.set(accountId, max._max.seq ?? 0);
    }
    const nextSeq = (accountId: string) => {
      const n = (seqs.get(accountId) ?? 0) + 1;
      seqs.set(accountId, n);
      return n;
    };

    const data = lines.map((l) => {
      const date = new Date(`${l.date}T00:00:00.000Z`);
      return {
        accountId: l.accountId,
        date,
        period: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
        seq: nextSeq(l.accountId),
        categoryId: pickCategory(l.key, l.categoryId),
        purpose: l.purpose,
        party: l.party,
        memo: l.memo,
        amountIn: l.amountIn,
        amountOut: l.amountOut,
        importKey: l.key,
      };
    });

    // How each counterparty was booked, for suggestions next time: matched lines first, then new ones.
    const hintMap = new Map<string, { accountId: string; counterparty: string; direction: string; categoryId: string | null; purpose: string; party: string }>();
    for (const m of preview.months) {
      if (!m.accountId) continue;
      for (const x of m.matched) {
        if (!x.counterparty) continue;
        const direction = x.net >= 0 ? "in" : "out";
        hintMap.set(`${m.accountId}|${x.counterparty}|${direction}`, {
          accountId: m.accountId,
          counterparty: x.counterparty,
          direction,
          categoryId: x.bookCategoryId,
          purpose: x.bookPurpose,
          party: x.bookParty,
        });
      }
    }
    for (const l of lines) {
      if (l.kind !== "entry" || !l.counterparty) continue;
      const direction = l.amountIn > 0 ? "in" : "out";
      hintMap.set(`${l.accountId}|${l.counterparty}|${direction}`, {
        accountId: l.accountId,
        counterparty: l.counterparty,
        direction,
        categoryId: pickCategory(l.key, l.categoryId),
        purpose: l.purpose,
        party: l.party,
      });
    }
    const hintRows = [...hintMap.values()];

    const detailUpdates = preview.accounts
      .map((a) => {
        const ticked = new Set(choices.details?.[a.accountId] ?? []);
        const set: Record<string, string> = {};
        for (const f of a.fields) if (ticked.has(f.key) && f.statement) set[f.key] = f.statement;
        return { id: a.accountId, set };
      })
      .filter((u) => Object.keys(u.set).length > 0);

    await prisma.$transaction(async (tx) => {
      if (data.length) await tx.cashTxn.createMany({ data, skipDuplicates: true });
      for (const h of hintRows) {
        await tx.cashHint.upsert({
          where: { accountId_counterparty_direction: { accountId: h.accountId, counterparty: h.counterparty, direction: h.direction } },
          update: { categoryId: h.categoryId, purpose: h.purpose, party: h.party },
          create: h,
        });
      }
      for (const u of detailUpdates) await tx.bankAccount.update({ where: { id: u.id }, data: u.set });
    });

    revalidatePath("/cash", "layout");
    revalidatePath("/settings");
    return { ok: true, added: data.length, updatedAccounts: detailUpdates.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't import the statements." };
  }
}