import "server-only";
import { prisma } from "@/lib/db";
import { settleInvoices, type SettledInvoice } from "./invoices";
import type { StatementPreview } from "./reconcile";

/* The approval queue for statement lines: nothing reaches the cash book
   until approveLine() runs. */

export type LineEdits = { date: string; categoryId: string; purpose: string; party: string; memo: string };

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
/** Ref-keyed lines (Industrial Bank) don't say their kind in the key; interest is booked as 存款利息. */
const kindOf = (key: string, purpose: string) =>
  key.endsWith(":interest") || (key.includes(":ref:") && purpose === "存款利息") ? "interest" : key.endsWith(":opening") ? "opening" : "entry";

/** Saves each statement month, queues its new lines and closes waiting lines the cash book now has. */
export async function stageStatements(preview: Omit<StatementPreview, "errors">, actorId: string | null) {
  const months = preview.months.filter((m) => m.accountId);
  let queued = 0;
  await prisma.$transaction(async (tx) => {
    for (const m of months) {
      const statement = {
        accountId: m.accountId!,
        file: m.file,
        currency: m.currency,
        periodStart: utc(m.periodStart),
        periodEnd: utc(m.periodEnd),
        opening: m.opening,
        closing: m.closing,
        uploadedAt: new Date(),
        uploadedById: actorId,
      };
      // Date-range downloads can cover part of a month: keep the widest period seen, each end with its balance.
      const saved = await tx.statementImport.findUnique({ where: { id: m.id } });
      if (saved) {
        if (saved.periodStart < statement.periodStart) {
          statement.periodStart = saved.periodStart;
          statement.opening = Number(saved.opening);
        }
        if (saved.periodEnd > statement.periodEnd) {
          statement.periodEnd = saved.periodEnd;
          statement.closing = Number(saved.closing);
        }
      }
      await tx.statementImport.upsert({ where: { id: m.id }, update: statement, create: { id: m.id, ...statement } });

      if (m.proposed.length) {
        const res = await tx.statementLine.createMany({
          data: m.proposed.map((l) => ({
            key: l.key,
            statementId: m.id,
            accountId: l.accountId,
            kind: l.kind,
            date: utc(l.date),
            amountIn: l.amountIn,
            amountOut: l.amountOut,
            categoryId: l.categoryId || null,
            purpose: l.purpose,
            party: l.party,
            memo: l.memo,
            description: l.description,
            counterparty: l.counterparty,
            suggested: l.suggested,
          })),
          skipDuplicates: true,
        });
        queued += res.count;
      }

      if (m.caughtUp.length) {
        await tx.statementLine.updateMany({
          where: { id: { in: m.caughtUp }, status: "PENDING" },
          data: { status: "IN_EXCEL", decidedAt: new Date(), decidedById: null },
        });
      }

      // Cash book lines added from this statement before the queue existed.
      const known = new Set((await tx.statementLine.findMany({ where: { statementId: m.id }, select: { key: true } })).map((l) => l.key));
      const orphans = await tx.cashTxn.findMany({ where: { accountId: m.accountId!, importKey: { startsWith: `${m.id}:` } } });
      const adopt = orphans.filter((t) => !known.has(t.importKey!));
      if (adopt.length) {
        await tx.statementLine.createMany({
          data: adopt.map((t) => ({
            key: t.importKey!,
            statementId: m.id,
            accountId: t.accountId,
            kind: kindOf(t.importKey!, t.purpose),
            date: t.date,
            amountIn: t.amountIn,
            amountOut: t.amountOut,
            categoryId: t.categoryId,
            purpose: t.purpose,
            party: t.party,
            memo: t.memo,
            status: "IMPORTED" as const,
            cashTxnId: t.id,
            decidedAt: t.createdAt,
          })),
          skipDuplicates: true,
        });
      }

      // How each counterparty was booked, for suggestions on later statements.
      for (const x of m.matched) {
        if (!x.counterparty) continue;
        const direction = x.net >= 0 ? "in" : "out";
        const data = { categoryId: x.bookCategoryId, purpose: x.bookPurpose, party: x.bookParty };
        await tx.cashHint.upsert({
          where: { accountId_counterparty_direction: { accountId: m.accountId!, counterparty: x.counterparty, direction } },
          update: data,
          create: { accountId: m.accountId!, counterparty: x.counterparty, direction, ...data },
        });
      }
    }
  });
  return { queued, months: months.length };
}

async function cleanEdits(edits: LineEdits) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edits.date) || Number.isNaN(utc(edits.date).getTime())) throw new Error("Enter a valid date.");
  let categoryId: string | null = null;
  if (edits.categoryId) {
    const found = await prisma.cashCategory.findUnique({ where: { id: edits.categoryId }, select: { id: true } });
    if (!found) throw new Error("That category no longer exists.");
    categoryId = found.id;
  }
  return {
    date: utc(edits.date),
    categoryId,
    purpose: edits.purpose.trim().slice(0, 500),
    party: edits.party.trim().slice(0, 200),
    memo: edits.memo.trim().slice(0, 500),
  };
}

export async function saveLine(id: string, edits: LineEdits) {
  const data = await cleanEdits(edits);
  const res = await prisma.statementLine.updateMany({ where: { id, status: "PENDING" }, data });
  if (!res.count) throw new Error("This line is no longer waiting for approval.");
}

/** Adds the line to the cash book; returns the invoices it marked paid. */
export async function approveLine(id: string, edits: LineEdits, actorId: string | null, opts: { markPaid: boolean } = { markPaid: false }) {
  const data = await cleanEdits(edits);
  return prisma.$transaction(async (tx): Promise<SettledInvoice[]> => {
    const line = await tx.statementLine.findUnique({ where: { id } });
    if (!line || line.status !== "PENDING") throw new Error("This line is no longer waiting for approval.");
    if (await tx.cashTxn.findUnique({ where: { importKey: line.key }, select: { id: true } })) {
      throw new Error("This line is already in the cash book.");
    }
    const max = await tx.cashTxn.aggregate({ where: { accountId: line.accountId }, _max: { seq: true } });
    const txn = await tx.cashTxn.create({
      data: {
        accountId: line.accountId,
        date: data.date,
        period: monthStart(data.date),
        seq: (max._max.seq ?? 0) + 1,
        categoryId: data.categoryId,
        purpose: data.purpose,
        party: data.party,
        memo: data.memo,
        amountIn: line.amountIn,
        amountOut: line.amountOut,
        importKey: line.key,
      },
    });
    if (line.kind === "entry" && line.counterparty) {
      const direction = Number(line.amountIn) > 0 ? "in" : "out";
      const hint = { categoryId: data.categoryId, purpose: data.purpose, party: data.party };
      await tx.cashHint.upsert({
        where: { accountId_counterparty_direction: { accountId: line.accountId, counterparty: line.counterparty, direction } },
        update: hint,
        create: { accountId: line.accountId, counterparty: line.counterparty, direction, ...hint },
      });
    }
    await tx.statementLine.update({
      where: { id },
      data: { ...data, status: "IMPORTED", cashTxnId: txn.id, decidedAt: new Date(), decidedById: actorId },
    });
    return settleInvoices(tx, { ...txn, amountIn: Number(txn.amountIn) }, { markPaid: opts.markPaid, actorId });
  });
}

export async function rejectLine(id: string, actorId: string | null) {
  const res = await prisma.statementLine.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: actorId } });
  if (!res.count) throw new Error("This line is no longer waiting for approval.");
}

export async function restoreLine(id: string) {
  const res = await prisma.statementLine.updateMany({ where: { id, status: "REJECTED" }, data: { status: "PENDING", decidedAt: null, decidedById: null } });
  if (!res.count) throw new Error("This line isn't rejected any more.");
}
