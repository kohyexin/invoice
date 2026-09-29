"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { draftFromInput, draftTotal, type ComposerInput } from "@/lib/composer";
import { fxRates, suggestInvoiceNumber, toUsd } from "@/lib/rules";
import { authorize, requireRole } from "@/lib/session";
import { freezeGeneratedPdf } from "@/lib/documents";
import { round2 } from "@/lib/utils";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function nextNumber(clientId: string) {
  await requireRole("STAFF");
  return suggestInvoiceNumber(clientId);
}

export async function createManualInvoice(input: ComposerInput, confirmReuse = false): Promise<Result<{ id: string; reuse?: string }>> {
  const auth = await authorize("STAFF");
  if (!auth.ok) return auth;
  const res = draftFromInput(input);
  if (!res.ok) return res;
  const d = res.draft;
  if (!input.clientId) return { ok: false, error: "Choose a client from the list so the invoice lands on their record." };

  if (!confirmReuse) {
    const taken = await prisma.invoice.count({ where: { number: d.number } });
    if (taken) return { ok: true, id: "", reuse: `${d.number} is already in the ledger. Save again to issue it anyway, or change the number.` };
  }

  const total = draftTotal(d);
  const typed = Number(String(input.usdAmount).replace(/,/g, ""));
  const usdAmount = input.usdAmount.trim() && Number.isFinite(typed) ? round2(typed) : toUsd(total, d.currency, await fxRates());
  if (usdAmount === null) return { ok: false, error: `No FX rate for ${d.currency}. Enter the USD amount or add a rate in Settings.` };

  try {
    const inv = await prisma.invoice.create({
      data: {
        number: d.number,
        clientId: input.clientId,
        alias: input.alias.trim().toUpperCase(),
        ownerId: input.ownerId || null,
        typeId: input.typeId || null,
        subtype: input.subtype.trim(),
        generate: "MANUAL",
        status: "SENT",
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
        createdById: auth.user.id,
        updatedById: auth.user.id,
        lines: {
          create: d.lines.map((l, i) => ({
            itemId: input.lines.filter((x) => x.description.trim())[i]?.itemId || null,
            description: l.description,
            detail: l.detail,
            rate: l.rate,
            quantity: l.quantity,
            amount: round2(l.rate * l.quantity),
            sortOrder: i,
          })),
        },
      },
    });
    await freezeGeneratedPdf(inv.id).catch(() => undefined);
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    revalidatePath(`/clients/${input.clientId}`);
    return { ok: true, id: inv.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the invoice." };
  }
}
