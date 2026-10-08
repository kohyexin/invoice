"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import type { Currency, Generate, InvoiceStatus } from "@/lib/generated/prisma/client";
import { CURRENCIES, STATUSES, parseDateInput, round2 } from "@/lib/utils";
import { fxRates, suggestInvoiceNumber, toUsd } from "@/lib/rules";
import { authorize, requireAccess } from "@/lib/session";
import { discardDocument, refreshDocument } from "@/lib/documents";
import { applyCreditToNewInvoice } from "@/lib/credit";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type EntryInput = {
  clientId: string;
  number: string;
  alias: string;
  ownerId: string;
  typeId: string;
  subtype: string;
  generate: Generate;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  currency: Currency;
  amount: string;
  usdAmount: string;
  receivedDate: string;
  receivedAmount: string;
  receivedCurrency: string;
  fee: string;
  paymentNote: string;
  notes: string;
};

export type PaymentInput = {
  receivedDate: string;
  receivedAmount: string;
  receivedCurrency: string;
  fee: string;
  paymentNote: string;
};

function money(v: string): number | null {
  const s = v.replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

function currencyOrNull(v: string): Currency | null {
  return (CURRENCIES as readonly string[]).includes(v) ? (v as Currency) : null;
}

function refresh(id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath("/clients", "layout");
  if (id) revalidatePath(`/invoices/${id}`);
}

/** Defaults for a new ledger row once a client is picked. */
export async function entryDefaults(clientId: string) {
  await requireAccess("invoices", "EDIT");
  const [client, number, last, fallbackOwner, usedAlias] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { alias: true, defaultOwnerId: true } }),
    suggestInvoiceNumber(clientId),
    prisma.invoice.findFirst({
      where: { clientId },
      orderBy: { invoiceDate: "desc" },
      select: { typeId: true, subtype: true, currency: true },
    }),
    prisma.owner.findFirst({ where: { isDefault: true, active: true }, select: { id: true } }),
    prisma.invoice.findFirst({ where: { clientId, alias: { not: "" } }, orderBy: { invoiceDate: "desc" }, select: { alias: true } }),
  ]);
  return {
    number,
    alias: client?.alias || usedAlias?.alias || "",
    ownerId: client?.defaultOwnerId ?? fallbackOwner?.id ?? "",
    typeId: last?.typeId ?? "",
    subtype: last?.subtype ?? "",
    currency: last?.currency ?? "USD",
  };
}

export async function saveEntry(id: string | null, input: EntryInput, confirmReuse = false): Promise<Result<{ id: string; reuse?: string }>> {
  const auth = await authorize("invoices", "EDIT");
  if (!auth.ok) return auth;
  const number = input.number.trim();
  const invoiceDate = parseDateInput(input.invoiceDate);
  const amount = money(input.amount);
  const currency = currencyOrNull(input.currency);
  if (!input.clientId) return { ok: false, error: "Pick a client." };
  if (!number) return { ok: false, error: "Invoice number is required." };
  if (!invoiceDate) return { ok: false, error: "Invoice date is required." };
  if (amount === null || !currency) return { ok: false, error: "Amount and currency are required." };
  if (!(STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: "Unknown status." };

  let usdAmount = currency === "USD" ? amount : money(input.usdAmount);
  if (usdAmount === null) usdAmount = toUsd(amount, currency, await fxRates());
  if (usdAmount === null) return { ok: false, error: `No FX rate for ${currency}. Enter the USD amount or add a rate in Settings.` };

  if (!confirmReuse) {
    const others = await prisma.invoice.findMany({
      where: { number, NOT: id ? { id } : undefined },
      select: { client: { select: { name: true } } },
      take: 3,
    });
    if (others.length) {
      return {
        ok: true,
        id: id ?? "",
        reuse: `${number} is already on ${others.length === 3 ? "3+" : others.length} row(s): ${[...new Set(others.map((o) => o.client.name))].join(", ")}. Save again to keep it.`,
      };
    }
  }

  const data = {
    clientId: input.clientId,
    number,
    alias: input.alias.trim().toUpperCase(),
    ownerId: input.ownerId || null,
    typeId: input.typeId || null,
    subtype: input.subtype.trim(),
    generate: input.generate === "SYSTEM" ? ("SYSTEM" as const) : ("MANUAL" as const),
    status: input.status,
    invoiceDate,
    dueDate: parseDateInput(input.dueDate),
    currency,
    amount,
    usdAmount,
    fxRate: currency === "USD" || amount === 0 ? null : usdAmount / amount,
    receivedDate: parseDateInput(input.receivedDate),
    receivedAmount: money(input.receivedAmount),
    receivedCurrency: currencyOrNull(input.receivedCurrency),
    fee: money(input.fee),
    paymentNote: input.paymentNote.trim(),
    notes: input.notes.trim(),
    updatedById: auth.user.id,
  };

  const composed = id ? await prisma.invoice.findFirst({ where: { id, companyId: { not: null }, lines: { some: {} } }, select: { id: true } }) : null;
  if (composed) {
    for (const key of ["clientId", "number", "invoiceDate", "dueDate", "currency", "amount", "usdAmount", "fxRate"] as const) delete (data as Partial<typeof data>)[key];
    const cur = await prisma.invoice.findUniqueOrThrow({ where: { id: composed.id }, select: { currency: true, amount: true } });
    if (cur.currency !== "USD") {
      const booked = money(input.usdAmount);
      if (booked !== null) Object.assign(data, { usdAmount: booked, fxRate: Number(cur.amount) ? booked / Number(cur.amount) : null });
    }
  }

  try {
    const before = id ? await prisma.invoice.findUnique({ where: { id } }) : null;
    const row = id
      ? await prisma.invoice.update({ where: { id }, data })
      : await prisma.invoice.create({ data: { ...data, createdById: auth.user.id } });
    await logActivity(auth.user, { action: id ? "update" : "create", entity: "invoice", entityId: row.id, label: row.number, before, after: data });
    if (!id) await applyCreditToNewInvoice(row.id, auth.user);
    if (id) await refreshDocument(row.id).catch(() => undefined);
    refresh(row.id);
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

export async function markPaid(id: string, input: PaymentInput): Promise<Result> {
  const auth = await authorize("invoices", "EDIT");
  if (!auth.ok) return auth;
  const receivedDate = parseDateInput(input.receivedDate);
  const receivedAmount = money(input.receivedAmount);
  if (!receivedDate) return { ok: false, error: "Received date is required." };
  if (receivedAmount === null) return { ok: false, error: "Received amount is required." };
  try {
    const before = await prisma.invoice.findUnique({ where: { id } });
    const data = {
      status: "PAID" as const,
      receivedDate,
      receivedAmount,
      receivedCurrency: currencyOrNull(input.receivedCurrency),
      fee: money(input.fee),
      paymentNote: input.paymentNote.trim(),
      updatedById: auth.user.id,
    };
    const row = await prisma.invoice.update({ where: { id }, data });
    await logActivity(auth.user, { action: "mark_paid", entity: "invoice", entityId: id, label: row.number, before, after: data });
    refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

export async function setStatus(id: string, status: InvoiceStatus): Promise<Result> {
  const auth = await authorize("invoices", "EDIT");
  if (!auth.ok) return auth;
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Unknown status." };
  const cleared = status === "SENT" ? { receivedDate: null, receivedAmount: null, receivedCurrency: null, fee: null } : {};
  const before = await prisma.invoice.findUnique({ where: { id } });
  const data = { status, ...cleared, updatedById: auth.user.id };
  const row = await prisma.invoice.update({ where: { id }, data });
  await logActivity(auth.user, { action: "update", entity: "invoice", entityId: id, label: row.number, before, after: data });
  refresh(id);
  return { ok: true };
}

export async function deleteEntry(id: string): Promise<Result> {
  const auth = await authorize("invoices", "EDIT");
  if (!auth.ok) return auth;
  await discardDocument(id);
  const before = await prisma.invoice.delete({ where: { id } });
  await logActivity(auth.user, { action: "delete", entity: "invoice", entityId: id, label: before.number, before });
  refresh();
  return { ok: true };
}
