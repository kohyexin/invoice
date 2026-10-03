"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { draftFromInput, draftTotal, type ComposerInput } from "@/lib/composer";
import { fxRates, suggestInvoiceNumber, toUsd } from "@/lib/rules";
import { authorize, requireRole } from "@/lib/session";
import { freezeGeneratedPdf } from "@/lib/documents";
import { round2 } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function nextNumber(clientId: string, agreementNo?: string) {
  await requireRole("STAFF");
  return suggestInvoiceNumber(clientId, agreementNo);
}

/** Validates composer input into invoice columns and line rows shared by create and update. */
async function prepare(input: ComposerInput, selfId: string | null, confirmReuse: boolean) {
  const res = draftFromInput(input);
  if (!res.ok) return res;
  const d = res.draft;
  if (!input.clientId) return { ok: false as const, error: "Choose a client from the list so the invoice lands on their record." };

  if (!confirmReuse) {
    const taken = await prisma.invoice.count({ where: { number: d.number, NOT: selfId ? { id: selfId } : undefined } });
    if (taken) return { ok: true as const, reuse: `${d.number} is already in the ledger. Save again to issue it anyway, or change the number.` };
  }

  const total = draftTotal(d);
  const typed = Number(String(input.usdAmount).replace(/,/g, ""));
  const usdAmount =
    d.currency === "USD" ? total : input.usdAmount.trim() && Number.isFinite(typed) ? round2(typed) : toUsd(total, d.currency, await fxRates());
  if (usdAmount === null) return { ok: false as const, error: `No FX rate for ${d.currency}. Enter the USD amount or add a rate in Settings.` };

  const itemIds = input.lines.filter((x) => x.description.trim()).map((x) => x.itemId || null);
  return {
    ok: true as const,
    data: {
      number: d.number,
      clientId: input.clientId,
      alias: input.alias.trim().toUpperCase(),
      ownerId: input.ownerId || null,
      typeId: input.typeId || null,
      subtype: input.subtype.trim(),
      invoiceDate: d.invoiceDate,
      dueDate: d.dueDate,
      reference: d.reference,
      currency: d.currency as ComposerInput["currency"],
      amount: total,
      usdAmount,
      fxRate: d.currency === "USD" || total === 0 ? null : usdAmount / total,
      taxAmount: d.taxAmount,
      amountPaid: d.amountPaid,
      altCurrency: (d.altCurrency as ComposerInput["currency"] | null) ?? null,
      altAmount: d.altAmount,
      billTo: d.billTo,
      companyId: d.companyId,
      language: d.language,
      bankAccountId: d.bankAccountId,
      extraAccountIds: d.extraAccountIds,
    },
    lines: d.lines.map((l, i) => ({
      itemId: itemIds[i] ?? null,
      description: l.description,
      detail: l.detail,
      rate: l.rate,
      quantity: l.quantity,
      amount: round2(l.rate * l.quantity),
      sortOrder: i,
    })),
  };
}

/** Remembers the alias and owner on the client the first time they are used, so the next invoice fills them in. */
async function learnClientDefaults(clientId: string, alias: string, ownerId: string | null) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { alias: true, defaultOwnerId: true } });
  if (!c) return;
  const data: { alias?: string; defaultOwnerId?: string } = {};
  if (!c.alias && alias) data.alias = alias;
  if (!c.defaultOwnerId && ownerId) data.defaultOwnerId = ownerId;
  if (Object.keys(data).length) await prisma.client.update({ where: { id: clientId }, data });
}

function refresh(clientId: string, id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/dashboard");
  revalidatePath(`/clients/${clientId}`);
  if (id) revalidatePath(`/invoices/${id}`);
}

export async function createManualInvoice(input: ComposerInput, confirmReuse = false): Promise<Result<{ id: string; reuse?: string }>> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const p = await prepare(input, null, confirmReuse);
  if (!p.ok) return p;
  if ("reuse" in p) return { ok: true, id: "", reuse: p.reuse };

  try {
    const inv = await prisma.invoice.create({
      data: {
        ...p.data,
        generate: "MANUAL",
        status: "SENT",
        createdById: auth.user.id,
        updatedById: auth.user.id,
        lines: { create: p.lines },
      },
    });
    await learnClientDefaults(p.data.clientId, p.data.alias, p.data.ownerId).catch(() => undefined);
    await freezeGeneratedPdf(inv.id).catch(() => undefined);
    refresh(p.data.clientId);
    return { ok: true, id: inv.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the invoice." };
  }
}

/** Saves edits to an invoice made in the app: replaces its lines and re-issues the PDF. Status and payment are kept. */
export async function updateManualInvoice(id: string, input: ComposerInput, confirmReuse = false): Promise<Result<{ id: string; reuse?: string }>> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const existing = await prisma.invoice.findUnique({ where: { id }, select: { clientId: true, companyId: true } });
  if (!existing) return { ok: false, error: "That invoice no longer exists." };
  if (!existing.companyId) return { ok: false, error: "This invoice wasn't made in the app, so it has no lines to edit." };
  const p = await prepare(input, id, confirmReuse);
  if (!p.ok) return p;
  if ("reuse" in p) return { ok: true, id, reuse: p.reuse };

  try {
    await prisma.$transaction([
      prisma.invoiceLine.deleteMany({ where: { invoiceId: id } }),
      prisma.invoice.update({ where: { id }, data: { ...p.data, updatedById: auth.user.id, lines: { create: p.lines } } }),
    ]);
    await learnClientDefaults(p.data.clientId, p.data.alias, p.data.ownerId).catch(() => undefined);
    await freezeGeneratedPdf(id).catch(() => undefined);
    refresh(p.data.clientId, id);
    if (existing.clientId !== p.data.clientId) revalidatePath(`/clients/${existing.clientId}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the invoice." };
  }
}
