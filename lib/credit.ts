import "server-only";
import { prisma } from "@/lib/db";
import { logActivity, type Actor } from "@/lib/activity";
import type { Currency, Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { round2 } from "@/lib/utils";

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

/** After an invoice is created: uses any credit the client has and logs it. */
export async function applyCreditToNewInvoice(invoiceId: string, actor: Actor | null) {
  const use = await prisma.$transaction((tx) => applyCredit(tx, invoiceId, actor?.id ?? null));
  if (use) await logCreditUse(actor, use);
  return use;
}

export async function logCreditUse(actor: Actor | null, use: CreditUse) {
  await logActivity(actor, { action: use.paid ? "mark_paid" : "update", entity: "invoice", entityId: use.invoiceId, label: use.number, before: use.before, after: use.after });
}
