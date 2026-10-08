"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { creditBalance, creditBalances, paidFields } from "@/lib/credit";
import { prisma } from "@/lib/db";
import type { Currency } from "@/lib/generated/prisma/client";
import { authorize, requireAccess } from "@/lib/session";
import { CURRENCIES, formatMoney, parseDateInput, round2 } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type OpenInvoice = { id: string; number: string; invoiceDate: string; currency: string; due: number };

/** A client's unpaid invoices (oldest first) and credit, for recording a payment. */
export async function paymentContext(clientId: string) {
  await requireAccess("invoices", "EDIT");
  const [invoices, credit] = await Promise.all([
    prisma.invoice.findMany({
      where: { clientId, status: "SENT" },
      orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
      select: { id: true, number: true, invoiceDate: true, currency: true, amount: true, amountPaid: true },
    }),
    creditBalances(prisma, clientId),
  ]);
  return {
    invoices: invoices
      .map((i) => ({ id: i.id, number: i.number, invoiceDate: i.invoiceDate.toISOString().slice(0, 10), currency: i.currency, due: round2(Number(i.amount) - Number(i.amountPaid)) }))
      .filter((i) => i.due > 0),
    credit,
  };
}

export type PaymentRecord = {
  clientId: string;
  currency: string;
  date: string;
  amount: string;
  fee: string;
  note: string;
  invoiceIds: string[];
};

const money = (v: string) => {
  const s = v.replace(/,/g, "").trim();
  const n = s ? Number(s) : 0;
  return Number.isFinite(n) ? round2(n) : NaN;
};

/** One payment from a client: pays the ticked invoices in full, using the client's credit
    when the payment falls short, and keeps anything left over as credit. */
export async function recordPayment(input: PaymentRecord): Promise<Result<{ paid: number; credit: number }>> {
  const auth = await authorize("invoices", "EDIT");
  if (!auth.ok) return auth;
  const date = parseDateInput(input.date);
  const amount = money(input.amount);
  const fee = money(input.fee);
  if (!input.clientId) return { ok: false, error: "Pick a client." };
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) return { ok: false, error: "Pick a currency." };
  if (!date) return { ok: false, error: "Received date is required." };
  if (Number.isNaN(amount) || amount < 0 || Number.isNaN(fee) || fee < 0) return { ok: false, error: "Enter amounts as numbers." };
  if (!amount && !input.invoiceIds.length) return { ok: false, error: "Enter the amount received or tick invoices to pay from credit." };
  const currency = input.currency as Currency;
  const note = input.note.trim();

  try {
    const out = await prisma.$transaction(async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: { id: { in: input.invoiceIds }, clientId: input.clientId, currency, status: "SENT" },
        orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
      });
      if (invoices.length !== input.invoiceIds.length) throw new Error("Some ticked invoices are no longer unpaid. Reopen the payment and try again.");
      const credit = await creditBalance(tx, input.clientId, currency);
      const due = round2(invoices.reduce((t, i) => t + Number(i.amount) - Number(i.amountPaid), 0));
      if (due > round2(amount + Math.max(credit, 0)) + 0.005) {
        throw new Error(`The ticked invoices come to ${currency} ${formatMoney(due)}, more than the payment plus credit (${currency} ${formatMoney(amount + Math.max(credit, 0))}). Untick some.`);
      }
      const fromCredit = round2(Math.max(due - amount, 0));
      const leftOver = round2(Math.max(amount - due, 0));
      const received = `${currency} ${formatMoney(amount)} received ${input.date}`;
      const paymentNote = note || (invoices.length > 1 || leftOver || fromCredit ? `Part of ${received}` : "");

      const paid = [];
      for (const [i, inv] of invoices.entries()) {
        const fields = paidFields(inv, date);
        const after = {
          ...fields,
          receivedAmount: i === 0 ? round2(fields.receivedAmount - fee) : fields.receivedAmount,
          fee: i === 0 && fee ? fee : null,
          paymentNote,
          updatedById: auth.user.id,
        };
        await tx.invoice.update({ where: { id: inv.id }, data: after });
        paid.push({ id: inv.id, number: inv.number, before: inv, after });
      }
      const last = invoices.at(-1);
      if (fromCredit) {
        await tx.clientCredit.create({
          data: { clientId: input.clientId, currency, amount: -fromCredit, date, invoiceId: last?.id ?? null, note: `Used with ${received}`, createdById: auth.user.id },
        });
      }
      if (leftOver) {
        await tx.clientCredit.create({
          data: { clientId: input.clientId, currency, amount: leftOver, date, note: note || `Left over from ${received}`, createdById: auth.user.id },
        });
      }
      return { paid, fromCredit, leftOver };
    });

    for (const p of out.paid) await logActivity(auth.user, { action: "mark_paid", entity: "invoice", entityId: p.id, label: p.number, before: p.before, after: p.after });
    if (out.fromCredit || out.leftOver) {
      await logActivity(auth.user, {
        action: "update",
        entity: "client",
        entityId: input.clientId,
        label: "Credit",
        changes: { currency, payment: amount, creditUsed: out.fromCredit, creditAdded: out.leftOver },
      });
    }
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    revalidatePath("/clients", "layout");
    return { ok: true, paid: out.paid.length, credit: round2(out.leftOver - out.fromCredit) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record the payment." };
  }
}
