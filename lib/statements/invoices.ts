import "server-only";
import type { Prisma } from "@/lib/generated/prisma/client";
import { round2 } from "@/lib/utils";

/* Ties statement receipts to invoices. The cash book keeps the paid invoice
   numbers in `party`, e.g. "SI2600001924, SI2600002020". */

export const invoiceNumbers = (party: string) => [...new Set(party.split(/[\s,，;；、]+/).filter(Boolean))];

export type OpenInvoice = { ids: string[]; number: string; currency: string; due: number; alias: string; clientId: string; invoiceDate: Date };

/** Party text that is only invoice numbers, e.g. "SI2600002018, 01052025-013": it belongs to one receipt, not to the payer. */
export const isInvoiceParty = (party: string) => {
  const numbers = invoiceNumbers(party);
  return numbers.length > 0 && numbers.every((n) => /^[A-Z]{0,3}\d{6,}(-\d+)?$/i.test(n));
};

/** Unpaid invoices by number; rows split by type are added together. */
export function openInvoices(rows: { id: string; number: string; currency: string; amount: unknown; amountPaid: unknown; alias: string; clientId: string; invoiceDate: Date }[]) {
  const byNumber = new Map<string, OpenInvoice>();
  for (const r of rows) {
    const key = `${r.number}|${r.currency}`;
    const due = Number(r.amount) - Number(r.amountPaid);
    const seen = byNumber.get(key);
    if (seen) {
      seen.due = round2(seen.due + due);
      seen.ids.push(r.id);
    } else byNumber.set(key, { ids: [r.id], number: r.number, currency: r.currency, due: round2(due), alias: r.alias, clientId: r.clientId, invoiceDate: r.invoiceDate });
  }
  return [...byNumber.values()];
}

/** The fewest invoices (2 to `max`) whose dues add up exactly to `amount`. */
export function exactInvoices(list: OpenInvoice[], amount: number, max = 6): OpenInvoice[] | undefined {
  const cents = list.map((i) => Math.round(i.due * 100));
  const target = Math.round(amount * 100);
  for (let size = 2; size <= Math.min(max, list.length); size++) {
    const pick: number[] = [];
    const walk = (from: number, sum: number): boolean => {
      if (pick.length === size) return sum === target;
      for (let i = from; i <= list.length - (size - pick.length); i++) {
        if (sum + cents[i] > target) continue;
        pick.push(i);
        if (walk(i + 1, sum + cents[i])) return true;
        pick.pop();
      }
      return false;
    };
    if (walk(0, 0)) return pick.map((i) => list[i]);
  }
  return undefined;
}

export type SettledInvoice = { id: string; number: string; before: Record<string, unknown>; after: Record<string, unknown> };

/** Links a new cash book receipt to the invoices named in its party and, when the
    receipt pays exactly what those unpaid invoices still owe, marks them paid. */
export async function settleInvoices(
  tx: Prisma.TransactionClient,
  txn: { id: string; accountId: string; date: Date; party: string; amountIn: number },
  opts: { markPaid: boolean; actorId: string | null },
): Promise<SettledInvoice[]> {
  const numbers = invoiceNumbers(txn.party);
  if (!numbers.length || txn.amountIn <= 0) return [];
  const rows = await tx.invoice.findMany({ where: { number: { in: numbers } }, orderBy: { invoiceDate: "asc" } });
  const first = numbers.map((n) => rows.find((r) => r.number === n)).find(Boolean);
  if (!first) return [];
  await tx.cashTxn.update({ where: { id: txn.id }, data: { invoiceId: first.id } });
  if (!opts.markPaid) return [];

  const account = await tx.bankAccount.findUniqueOrThrow({ where: { id: txn.accountId }, select: { currency: true } });
  const open = rows.filter((r) => r.status === "SENT");
  const due = round2(open.reduce((t, r) => t + Number(r.amount) - Number(r.amountPaid), 0));
  const allOpen = numbers.every((n) => open.some((r) => r.number === n));
  if (!allOpen || open.some((r) => r.currency !== account.currency) || due !== round2(txn.amountIn)) return [];

  const settled: SettledInvoice[] = [];
  for (const r of open) {
    const after = {
      status: "PAID" as const,
      receivedDate: txn.date,
      receivedAmount: Number(r.usdAmount),
      receivedCurrency: r.currency === "USD" ? null : r.currency,
      updatedById: opts.actorId,
    };
    await tx.invoice.update({ where: { id: r.id }, data: after });
    settled.push({ id: r.id, number: r.number, before: r, after });
  }
  return settled;
}
