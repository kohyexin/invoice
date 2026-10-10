"use server";

import { revalidatePath } from "next/cache";
import { applyPayment, creditBalances, logPayment } from "@/lib/credit";
import { prisma } from "@/lib/db";
import type { Currency } from "@/lib/generated/prisma/client";
import { authorize, requireAccess } from "@/lib/session";
import { CURRENCIES, formatMoney, parseDateInput, round2 } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type OpenInvoice = { id: string; number: string; invoiceDate: string; currency: string; due: number };

/** A client's unpaid invoices (oldest first) and credit, for recording a payment. */
export async function paymentContext(clientId: string) {
  await requireAccess("invoicePayments", "EDIT");
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
  const auth = await authorize("invoicePayments", "EDIT");
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

  try {
    const out = await prisma.$transaction((tx) =>
      applyPayment(tx, { clientId: input.clientId, currency, date, amount, fee, invoiceIds: input.invoiceIds, note: input.note, actorId: auth.user.id }),
    );
    await logPayment(auth.user, out);
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    revalidatePath("/clients", "layout");
    return { ok: true, paid: out.paid.length, credit: round2(out.leftOver - out.fromCredit) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record the payment." };
  }
}
