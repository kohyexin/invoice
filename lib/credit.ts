import "server-only";
import { prisma } from "@/lib/db";
import { logActivity, type Actor } from "@/lib/activity";
import type { Currency, Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { formatMoney, round2 } from "@/lib/utils";

/* Client credit: money a client paid beyond what their invoices took. It is used up
   by their next invoices in the same currency, oldest first. */

type Db = PrismaClient | Prisma.TransactionClient;

export async function creditBalance(db: Db, clientId: string, currency: Currency) {
  const sum = await db.clientCredit.aggregate({ where: { clientId, currency }, _sum: { amount: true } });
  return round2(Number(sum._sum.amount ?? 0));
}

/** Non-zero balances per currency. */
export async function creditBalances(db: Db, clientId: string) {
  const rows = await db.clientCredit.groupBy({ by: ["currency"], where: { clientId }, _sum: { amount: true } });
  return rows.map((r) => ({ currency: r.currency, amount: round2(Number(r._sum.amount ?? 0)) })).filter((r) => Math.abs(r.amount) >= 0.005);
}

export const paidFields = (inv: { currency: Currency; usdAmount: unknown }, date: Date) => ({
  status: "PAID" as const,
  receivedDate: date,
  receivedAmount: round2(Number(inv.usdAmount)),
  receivedCurrency: inv.currency === "USD" ? null : inv.currency,
});

export type CreditUse = { invoiceId: string; number: string; used: number; paid: boolean; before: Record<string, unknown>; after: Record<string, unknown> };

/** Uses the client's credit on one unpaid invoice: marks it paid when the credit covers
    what is due, otherwise records the credit as Amount Paid so less is due. */
export async function applyCredit(db: Db, invoiceId: string, actorId: string | null): Promise<CreditUse | null> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.status !== "SENT") return null;
  const due = round2(Number(inv.amount) - Number(inv.amountPaid));
  if (due <= 0) return null;
  const balance = await creditBalance(db, inv.clientId, inv.currency);
  if (balance < 0.005) return null;

  const source = await db.clientCredit.findFirst({
    where: { clientId: inv.clientId, currency: inv.currency, amount: { gt: 0 } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { date: true },
  });
  const date = source?.date ?? new Date();
  const used = round2(Math.min(balance, due));
  const paid = used >= due;
  const after: Record<string, unknown> = paid
    ? { ...paidFields(inv, date), paymentNote: [inv.paymentNote, "Paid from credit"].filter(Boolean).join(" · "), updatedById: actorId }
    : { amountPaid: round2(Number(inv.amountPaid) + used), updatedById: actorId };

  await db.invoice.update({ where: { id: inv.id }, data: after });
  await db.clientCredit.create({
    data: { clientId: inv.clientId, currency: inv.currency, amount: -used, date, invoiceId: inv.id, note: `Used on ${inv.number}`, createdById: actorId },
  });
  return { invoiceId: inv.id, number: inv.number, used, paid, before: inv, after };
}

export type PaymentInput = {
  clientId: string;
  currency: Currency;
  date: Date;
  amount: number;
  /** Bank fee, taken off the first invoice's received amount. */
  fee: number;
  invoiceIds: string[];
  note: string;
  actorId: string | null;
  /** The cash book receipt, when the payment came from a bank statement. */
  cashTxnId?: string | null;
};
export type PaidInvoice = { id: string; number: string; before: Record<string, unknown>; after: Record<string, unknown> };
export type PaymentResult = { clientId: string; currency: Currency; amount: number; paid: PaidInvoice[]; fromCredit: number; leftOver: number };

/** One payment from a client: pays the ticked invoices in full, using the client's credit
    when the payment falls short, and keeps anything left over as credit. */
export async function applyPayment(db: Db, input: PaymentInput): Promise<PaymentResult> {
  const { clientId, currency, date, amount, fee, actorId } = input;
  const invoices = await db.invoice.findMany({
    where: { id: { in: input.invoiceIds }, clientId, currency, status: "SENT" },
    orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
  });
  if (invoices.length !== new Set(input.invoiceIds).size) throw new Error("Some ticked invoices are no longer unpaid. Reopen the payment and try again.");
  const credit = await creditBalance(db, clientId, currency);
  const due = round2(invoices.reduce((t, i) => t + Number(i.amount) - Number(i.amountPaid), 0));
  if (due > round2(amount + Math.max(credit, 0)) + 0.005) {
    throw new Error(
      `The ticked invoices come to ${currency} ${formatMoney(due)}, more than the payment plus credit (${currency} ${formatMoney(amount + Math.max(credit, 0))}). Untick some.`,
    );
  }
  const fromCredit = round2(Math.max(due - amount, 0));
  const leftOver = round2(Math.max(amount - due, 0));
  const received = `${currency} ${formatMoney(amount)} received ${date.toISOString().slice(0, 10)}`;
  const note = input.note.trim();
  const paymentNote = note || (invoices.length > 1 || leftOver || fromCredit ? `Part of ${received}` : "");

  const paid: PaidInvoice[] = [];
  for (const [i, inv] of invoices.entries()) {
    const fields = paidFields(inv, date);
    const after = {
      ...fields,
      receivedAmount: i === 0 ? round2(fields.receivedAmount - fee) : fields.receivedAmount,
      fee: i === 0 && fee ? fee : null,
      paymentNote,
      updatedById: actorId,
    };
    await db.invoice.update({ where: { id: inv.id }, data: after });
    paid.push({ id: inv.id, number: inv.number, before: inv, after });
  }
  const last = invoices.at(-1);
  const cashTxnId = input.cashTxnId ?? null;
  if (fromCredit) {
    await db.clientCredit.create({
      data: { clientId, currency, amount: -fromCredit, date, invoiceId: last?.id ?? null, note: `Used with ${received}`, cashTxnId, createdById: actorId },
    });
  }
  if (leftOver) {
    await db.clientCredit.create({ data: { clientId, currency, amount: leftOver, date, note: note || `Left over from ${received}`, cashTxnId, createdById: actorId } });
  }
  return { clientId, currency, amount, paid, fromCredit, leftOver };
}

/** Logs a payment: each invoice marked paid, and the credit change. */
export async function logPayment(actor: Actor | null, p: PaymentResult) {
  for (const x of p.paid) await logActivity(actor, { action: "mark_paid", entity: "invoice", entityId: x.id, label: x.number, before: x.before, after: x.after });
  if (p.fromCredit || p.leftOver) {
    await logActivity(actor, {
      action: "update",
      entity: "client",
      entityId: p.clientId,
      label: "Credit",
      changes: { currency: p.currency, payment: p.amount, creditUsed: p.fromCredit, creditAdded: p.leftOver },
    });
  }
}

/** After an invoice is created: uses any credit the client has and logs it. */
export async function applyCreditToNewInvoice(invoiceId: string, actor: Actor | null) {
  const use = await prisma.$transaction((tx) => applyCredit(tx, invoiceId, actor?.id ?? null));
  if (use) await logCreditUse(actor, use);
  return use;
}

export async function logCreditUse(actor: Actor | null, use: CreditUse) {
  await logActivity(actor, { action: use.paid ? "mark_paid" : "update", entity: "invoice", entityId: use.invoiceId, label: use.number, before: use.before, after: use.after });
}
