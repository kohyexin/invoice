"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { applyPayment, creditBalance, logPayment, paidFields } from "@/lib/credit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/roles";
import { authorize } from "@/lib/session";
import { formatMoney, parseDateInput, round2 } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** A receipt linked to an invoice that is still unpaid, offered to be marked paid after saving. */
export type UnpaidLink = {
  cashTxnId: string;
  number: string;
  client: string;
  currency: string;
  due: number;
  receivedCurrency: string;
  received: number;
  /** Same currency: what the receipt leaves over (to credit) or what credit must add. */
  leftOver: number;
  fromCredit: number;
  /** Same currency, and the receipt plus credit still doesn't cover what is due. */
  short: number;
};

/** The unpaid invoice rows a receipt pays (an invoice split by type has several rows with one number). */
async function unpaidFor(cashTxnId: string) {
  const txn = await prisma.cashTxn.findUnique({
    where: { id: cashTxnId },
    include: { account: { select: { currency: true } }, invoice: { select: { number: true, clientId: true, currency: true, client: { select: { name: true } } } } },
  });
  if (!txn?.invoice || Number(txn.amountIn) <= 0) return null;
  const rows = await prisma.invoice.findMany({
    where: { number: txn.invoice.number, clientId: txn.invoice.clientId, currency: txn.invoice.currency, status: "SENT" },
    orderBy: { invoiceDate: "asc" },
  });
  const due = round2(rows.reduce((t, r) => t + Number(r.amount) - Number(r.amountPaid), 0));
  if (!rows.length || due <= 0) return null;
  return { txn, invoice: txn.invoice, rows, due };
}

async function unpaidLink(cashTxnId: string): Promise<UnpaidLink | null> {
  const found = await unpaidFor(cashTxnId);
  if (!found) return null;
  const { txn, invoice, due } = found;
  const received = Number(txn.amountIn);
  const same = txn.account.currency === invoice.currency;
  const credit = same ? Math.max(await creditBalance(prisma, invoice.clientId, invoice.currency), 0) : 0;
  return {
    cashTxnId,
    number: invoice.number,
    client: invoice.client.name,
    currency: invoice.currency,
    due,
    receivedCurrency: txn.account.currency,
    received,
    leftOver: same ? round2(Math.max(received - due, 0)) : 0,
    fromCredit: same ? round2(Math.min(Math.max(due - received, 0), credit)) : 0,
    short: same ? round2(Math.max(due - received - credit, 0)) : 0,
  };
}

/** Marks the invoice a cash book receipt is linked to as paid, like Record payment:
 *  in the same currency, anything over becomes credit and a shortfall uses credit. */
export async function markLinkedInvoicePaid(cashTxnId: string): Promise<Result<{ number: string }>> {
  const auth = await authorize("invoicePayments", "EDIT");
  if (!auth.ok) return auth;
  const found = await unpaidFor(cashTxnId);
  if (!found) return { ok: false, error: "The linked invoice is already paid or no longer unpaid." };
  const { txn, invoice, rows, due } = found;
  const received = Number(txn.amountIn);
  const currency = txn.account.currency;
  try {
    const credit = currency === invoice.currency ? await creditBalance(prisma, invoice.clientId, currency) : 0;
    if (currency === invoice.currency && round2(received + Math.max(credit, 0)) + 0.005 >= due) {
      const payment = await prisma.$transaction((tx) =>
        applyPayment(tx, { clientId: invoice.clientId, currency, date: txn.date, amount: received, fee: 0, invoiceIds: rows.map((r) => r.id), note: "", actorId: auth.user.id, cashTxnId }),
      );
      await logPayment(auth.user, payment);
    } else {
      const paymentNote = `${currency} ${formatMoney(received)} received ${txn.date.toISOString().slice(0, 10)}`;
      for (const r of rows) {
        const after = { ...paidFields(r, txn.date), paymentNote: [r.paymentNote, paymentNote].filter(Boolean).join(" · "), updatedById: auth.user.id };
        await prisma.invoice.update({ where: { id: r.id }, data: after });
        await logActivity(auth.user, { action: "mark_paid", entity: "invoice", entityId: r.id, label: r.number, before: r, after });
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not mark the invoice paid." };
  }
  refresh();
  revalidatePath("/invoices", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/clients", "layout");
  return { ok: true, number: invoice.number };
}

export type CashTxnInput = {
  date: string;
  /** yyyy-mm; blank means the month of `date`. */
  period: string;
  accountId: string;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  amountIn: string;
  amountOut: string;
  invoiceNumber: string;
};

function amount(raw: string) {
  const s = raw.replace(/,/g, "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : NaN;
}

function refresh() {
  revalidatePath("/cash", "layout");
}

/** Saves the line; `unpaid` is set when it is a receipt linked to an invoice that is still unpaid
 *  and the user may mark invoices paid. */
export async function saveCashTxn(id: string | null, input: CashTxnInput): Promise<Result<{ unpaid: UnpaidLink | null }>> {
  const auth = await authorize("cashBook", "EDIT");
  if (!auth.ok) return auth;

  const date = parseDateInput(input.date);
  if (!date) return { ok: false, error: "Enter the date." };
  const pm = input.period.trim().match(/^(\d{4})-(\d{2})$/);
  if (input.period.trim() && !pm) return { ok: false, error: "Month used must be a month, e.g. 2026-08." };
  const period = pm
    ? new Date(Date.UTC(+pm[1], +pm[2] - 1, 1))
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const amountIn = amount(input.amountIn);
  const amountOut = amount(input.amountOut);
  if (Number.isNaN(amountIn) || Number.isNaN(amountOut)) return { ok: false, error: "Amounts must be numbers." };
  if (amountIn < 0 || amountOut < 0) return { ok: false, error: "Enter amounts as positive numbers; use Money out for payments." };
  if (!amountIn && !amountOut) return { ok: false, error: "Enter money in or money out." };

  const account = await prisma.bankAccount.findUnique({ where: { id: input.accountId }, select: { id: true, use: true } });
  if (!account || account.use === "INVOICE") return { ok: false, error: "Pick a balance-sheet account." };

  const categoryId = input.categoryId || null;
  if (categoryId && !(await prisma.cashCategory.findUnique({ where: { id: categoryId }, select: { id: true } }))) {
    return { ok: false, error: "That category no longer exists." };
  }

  let invoiceId: string | null = null;
  const number = input.invoiceNumber.trim();
  if (number) {
    const inv = await prisma.invoice.findFirst({
      where: { number: { equals: number, mode: "insensitive" } },
      orderBy: { invoiceDate: "desc" },
      select: { id: true },
    });
    if (!inv) return { ok: false, error: `No invoice numbered ${number}.` };
    invoiceId = inv.id;
  }

  const data = {
    date,
    period,
    accountId: account.id,
    categoryId,
    purpose: input.purpose.trim(),
    party: input.party.trim(),
    memo: input.memo.trim(),
    amountIn,
    amountOut,
    invoiceId,
  };

  const label = [input.date, data.party || data.purpose].filter(Boolean).join(" · ");
  let savedId: string;
  if (id) {
    const existing = await prisma.cashTxn.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "That line no longer exists." };
    const seq = existing.accountId === account.id ? existing.seq : await nextSeq(account.id);
    await prisma.cashTxn.update({ where: { id }, data: { ...data, seq } });
    await logActivity(auth.user, { action: "update", entity: "cash_entry", entityId: id, label, before: existing, after: data });
    savedId = id;
  } else {
    const row = await prisma.cashTxn.create({ data: { ...data, seq: await nextSeq(account.id) } });
    await logActivity(auth.user, { action: "create", entity: "cash_entry", entityId: row.id, label, after: data });
    savedId = row.id;
  }
  refresh();
  const unpaid = invoiceId && amountIn > 0 && can(auth.user.role, "invoicePayments", "EDIT") ? await unpaidLink(savedId) : null;
  return { ok: true, unpaid };
}

/** New lines sort after everything already on the account for the same day. */
async function nextSeq(accountId: string) {
  const max = await prisma.cashTxn.aggregate({ where: { accountId }, _max: { seq: true } });
  return (max._max.seq ?? 0) + 1;
}

export async function deleteCashTxn(id: string): Promise<Result> {
  const auth = await authorize("cashBook", "EDIT");
  if (!auth.ok) return auth;
  const before = await prisma.cashTxn.delete({ where: { id } }).catch(() => null);
  if (before)
    await logActivity(auth.user, {
      action: "delete",
      entity: "cash_entry",
      entityId: id,
      label: [before.date.toISOString().slice(0, 10), before.party || before.purpose].filter(Boolean).join(" · "),
      before,
    });
  refresh();
  return { ok: true };
}
