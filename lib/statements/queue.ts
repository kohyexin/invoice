import "server-only";
import { prisma } from "@/lib/db";
import { applyPayment, creditBalance, type PaymentResult } from "@/lib/credit";
import { Prisma, type Currency } from "@/lib/generated/prisma/client";
import { round2 } from "@/lib/utils";
import { invoiceNumbers, settleInvoices, type SettledInvoice } from "./invoices";
import { periodLag, splitPatternOf, type StatementPreview } from "./reconcile";
import type { SplitPattern, SplitRow } from "./types";

/* The approval queue for statement lines: nothing reaches the cash book
   until approveLine() runs. */

/**
 * `period` is the 使用月 as yyyy-mm. Receipts may name the client and invoices they pay
 * (anything left over becomes the client's credit). `splits` books the bank line as several
 * cash book lines, which must add up to it.
 */
export type LineEdits = {
  date: string;
  period: string;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  clientId?: string;
  invoiceIds?: string[];
  splits?: SplitRow[] | null;
};

/** What approving a line did to invoices and credit, for the activity log. */
export type ApproveResult = { settled: SettledInvoice[]; payments: PaymentResult[] };

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const json = (v: unknown) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));
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
            period: utc(`${l.period}-01`),
            amountIn: l.amountIn,
            amountOut: l.amountOut,
            categoryId: l.categoryId || null,
            purpose: l.purpose,
            party: l.party,
            memo: l.memo,
            description: l.description,
            counterparty: l.counterparty,
            suggested: l.suggested,
            clientId: l.clientId || null,
            invoiceIds: l.invoiceIds.length ? l.invoiceIds : Prisma.DbNull,
            splits: json(l.splits),
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
      const adopt = orphans.filter((t) => !known.has(t.importKey!) && !t.importKey!.includes("#"));
      if (adopt.length) {
        await tx.statementLine.createMany({
          data: adopt.map((t) => ({
            key: t.importKey!,
            statementId: m.id,
            accountId: t.accountId,
            kind: kindOf(t.importKey!, t.purpose),
            date: t.date,
            period: t.period,
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
        const data = { categoryId: x.bookCategoryId, purpose: x.bookPurpose, party: x.bookParty, periodLag: x.bookPeriodLag, splits: json(x.bookSplits) };
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

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const money = (v: unknown) => {
  const n = round2(Number(v) || 0);
  if (n < 0) throw new Error("Split amounts can't be negative; pick money in or out instead.");
  return n;
};

async function cleanEdits(edits: LineEdits) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(edits.date) || Number.isNaN(utc(edits.date).getTime())) throw new Error("Enter a valid date.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(edits.period)) throw new Error("Month used must be a month, e.g. 2026-08.");
  const splits = edits.splits?.length ? edits.splits : null;
  const categoryIds = [...new Set([edits.categoryId, ...(splits ?? []).map((s) => s.categoryId)].filter(Boolean))];
  const found = categoryIds.length ? await prisma.cashCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true } }) : [];
  if (found.length !== categoryIds.length) throw new Error("That category no longer exists.");
  const rows: SplitRow[] | null = splits
    ? splits.map((s) => ({
        categoryId: s.categoryId,
        purpose: text(s.purpose, 500),
        party: text(s.party, 200),
        memo: text(s.memo, 500),
        amountIn: money(s.amountIn),
        amountOut: money(s.amountOut),
      }))
    : null;
  const lead = rows?.[0];
  return {
    date: utc(edits.date),
    period: utc(`${edits.period}-01`),
    categoryId: (lead ? lead.categoryId : edits.categoryId) || null,
    purpose: lead ? lead.purpose : text(edits.purpose, 500),
    party: lead ? lead.party : text(edits.party, 200),
    memo: lead ? lead.memo : text(edits.memo, 500),
    clientId: edits.clientId || null,
    invoiceIds: [...new Set(edits.invoiceIds ?? [])],
    splits: rows,
  };
}
type Clean = Awaited<ReturnType<typeof cleanEdits>>;

const lineData = (data: Clean) => ({
  date: data.date,
  period: data.period,
  categoryId: data.categoryId,
  purpose: data.purpose,
  party: data.party,
  memo: data.memo,
  clientId: data.clientId,
  invoiceIds: data.invoiceIds.length ? data.invoiceIds : Prisma.DbNull,
  splits: json(data.splits),
});

export async function saveLine(id: string, edits: LineEdits) {
  const data = await cleanEdits(edits);
  const res = await prisma.statementLine.updateMany({ where: { id, status: "PENDING" }, data: lineData(data) });
  if (!res.count) throw new Error("This line is no longer waiting for approval.");
}

/**
 * A receipt row against invoices: the ticked ones (or those its party names), paid like a
 * recorded payment so overpayments become credit and shortfalls use it. Invoices of several
 * clients are only marked paid when they add up exactly.
 */
async function payInvoices(
  tx: Prisma.TransactionClient,
  txn: { id: string; accountId: string; date: Date; party: string; amountIn: number },
  pick: { clientId: string | null; invoiceIds: string[] },
  currency: Currency,
  actorId: string | null,
  markPaid: boolean,
): Promise<{ settled: SettledInvoice[]; payment: PaymentResult | null }> {
  if (txn.amountIn <= 0) return { settled: [], payment: null };
  const exactOnly = async () => ({ settled: await settleInvoices(tx, txn, { markPaid, actorId }), payment: null });
  let { clientId, invoiceIds } = pick;
  if (!clientId && invoiceIds.length) return exactOnly();
  if (!clientId) {
    const numbers = invoiceNumbers(txn.party);
    const rows = numbers.length
      ? await tx.invoice.findMany({ where: { number: { in: numbers } }, select: { id: true, clientId: true, currency: true, status: true, amount: true, amountPaid: true } })
      : [];
    if (!rows.length) return { settled: [], payment: null };
    const open = rows.filter((r) => r.status === "SENT" && r.currency === currency);
    if (new Set(rows.map((r) => r.clientId)).size > 1 || open.length !== rows.length) return exactOnly();
    // Typed invoice numbers that the receipt and credit can't cover are only linked.
    const due = round2(open.reduce((t, r) => t + Number(r.amount) - Number(r.amountPaid), 0));
    const credit = await creditBalance(tx, rows[0].clientId, currency);
    if (due > round2(txn.amountIn + Math.max(credit, 0)) + 0.005) return exactOnly();
    clientId = rows[0].clientId;
    invoiceIds = open.map((r) => r.id);
  }
  if (invoiceIds.length) {
    const first = await tx.invoice.findFirst({ where: { id: { in: invoiceIds } }, orderBy: { invoiceDate: "asc" }, select: { id: true } });
    if (first) await tx.cashTxn.update({ where: { id: txn.id }, data: { invoiceId: first.id } });
  }
  if (!markPaid || !clientId) return { settled: [], payment: null };
  const payment = await applyPayment(tx, { clientId, currency, date: txn.date, amount: txn.amountIn, fee: 0, invoiceIds, note: "", actorId, cashTxnId: txn.id });
  return { settled: [], payment };
}

/** Adds the line to the cash book (several lines when split); returns what it did to invoices and credit. */
export async function approveLine(id: string, edits: LineEdits, actorId: string | null, opts: { markPaid: boolean } = { markPaid: false }) {
  const data = await cleanEdits(edits);
  return prisma.$transaction(async (tx): Promise<ApproveResult> => {
    const line = await tx.statementLine.findUnique({ where: { id }, include: { account: { select: { currency: true } } } });
    if (!line || line.status !== "PENDING") throw new Error("This line is no longer waiting for approval.");
    if (await tx.cashTxn.findFirst({ where: { importKey: { in: [line.key, `${line.key}#2`] } }, select: { id: true } })) {
      throw new Error("This line is already in the cash book.");
    }
    const bankNet = round2(Number(line.amountIn) - Number(line.amountOut));
    const rows: SplitRow[] = data.splits ?? [
      { categoryId: data.categoryId ?? "", purpose: data.purpose, party: data.party, memo: data.memo, amountIn: Number(line.amountIn), amountOut: Number(line.amountOut) },
    ];
    if (data.splits) {
      const total = round2(rows.reduce((t, r) => t + r.amountIn - r.amountOut, 0));
      if (total !== bankNet) throw new Error(`Split rows must add up to ${bankNet.toFixed(2)}; they come to ${total.toFixed(2)}.`);
      if (rows.some((r) => !r.categoryId)) throw new Error("Pick a category for every split row.");
    }

    const max = await tx.cashTxn.aggregate({ where: { accountId: line.accountId }, _max: { seq: true } });
    const result: ApproveResult = { settled: [], payments: [] };
    let first: { id: string } | null = null;
    for (const [i, r] of rows.entries()) {
      const txn = await tx.cashTxn.create({
        data: {
          accountId: line.accountId,
          date: data.date,
          period: data.period,
          seq: (max._max.seq ?? 0) + 1 + i,
          categoryId: r.categoryId || null,
          purpose: r.purpose,
          party: r.party,
          memo: r.memo,
          amountIn: r.amountIn,
          amountOut: r.amountOut,
          importKey: i === 0 ? line.key : `${line.key}#${i + 1}`,
        },
      });
      first ??= txn;
      // A single line uses the client and invoices picked on the card; split rows go by their party.
      const pick = data.splits ? { clientId: null, invoiceIds: [] } : { clientId: data.clientId, invoiceIds: data.invoiceIds };
      const paid = await payInvoices(tx, { ...txn, amountIn: r.amountIn }, pick, line.account.currency, actorId, opts.markPaid);
      result.settled.push(...paid.settled);
      if (paid.payment) result.payments.push(paid.payment);
    }

    if (line.kind === "entry" && line.counterparty) {
      const direction = bankNet > 0 ? "in" : "out";
      const splits: SplitPattern[] | null = data.splits ? splitPatternOf(rows, line.description) : null;
      const hint = { categoryId: data.categoryId, purpose: data.purpose, party: data.party, periodLag: periodLag(data.date, data.period), splits: json(splits) };
      await tx.cashHint.upsert({
        where: { accountId_counterparty_direction: { accountId: line.accountId, counterparty: line.counterparty, direction } },
        update: hint,
        create: { accountId: line.accountId, counterparty: line.counterparty, direction, ...hint },
      });
    }
    await tx.statementLine.update({
      where: { id },
      data: { ...lineData(data), status: "IMPORTED", cashTxnId: first!.id, decidedAt: new Date(), decidedById: actorId },
    });
    return result;
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
