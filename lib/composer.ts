import "server-only";
import type { Currency, Language } from "@/lib/generated/prisma/client";
import { CURRENCIES, parseDateInput, round2 } from "@/lib/utils";
import type { InvoiceDraft } from "@/lib/pdf/render";

export type ComposerLine = { itemId: string; description: string; detail: string; rate: string; quantity: string };

export type ComposerInput = {
  companyId: string;
  language: Language;
  clientId: string;
  billTo: { name: string; attention: string; lines: string[] };
  number: string;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  currency: Currency;
  lines: ComposerLine[];
  taxAmount: string;
  amountPaid: string;
  altCurrency: string;
  altAmount: string;
  bankAccountId: string;
  extraAccountIds: string[];
  typeId: string;
  subtype: string;
  ownerId: string;
  alias: string;
  usdAmount: string;
};

const n = (v: string) => {
  const x = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(x) ? x : 0;
};

const isCurrency = (v: string): v is Currency => (CURRENCIES as readonly string[]).includes(v);

/** Validates composer input and returns a printable draft, or an error. */
export function draftFromInput(input: ComposerInput): { ok: true; draft: InvoiceDraft } | { ok: false; error: string } {
  const invoiceDate = parseDateInput(input.invoiceDate);
  if (!input.companyId) return { ok: false, error: "Choose the issuing company." };
  if (!input.billTo.name.trim()) return { ok: false, error: "Choose a client to bill." };
  if (!input.number.trim()) return { ok: false, error: "Invoice number is required." };
  if (!invoiceDate) return { ok: false, error: "Invoice date is required." };
  if (!isCurrency(input.currency)) return { ok: false, error: "Choose a currency." };
  const lines = input.lines
    .filter((l) => l.description.trim())
    .map((l) => ({ description: l.description.trim(), detail: l.detail.trim(), rate: n(l.rate), quantity: n(l.quantity) || 1 }));
  if (lines.length === 0) return { ok: false, error: "Add at least one line with a description." };
  const alt = input.altCurrency && isCurrency(input.altCurrency) && input.altCurrency !== input.currency ? input.altCurrency : null;

  return {
    ok: true,
    draft: {
      companyId: input.companyId,
      language: input.language === "ZH" ? "ZH" : "EN",
      billTo: {
        name: input.billTo.name.trim(),
        attention: input.billTo.attention.trim(),
        lines: input.billTo.lines.map((l) => l.trim()).filter(Boolean),
      },
      number: input.number.trim(),
      reference: input.reference.trim(),
      invoiceDate,
      dueDate: parseDateInput(input.dueDate),
      currency: input.currency,
      lines,
      taxAmount: round2(n(input.taxAmount)),
      amountPaid: round2(n(input.amountPaid)),
      altCurrency: alt,
      altAmount: alt ? round2(n(input.altAmount)) : null,
      bankAccountId: input.bankAccountId || null,
      extraAccountIds: input.extraAccountIds,
    },
  };
}

export function draftTotal(d: InvoiceDraft) {
  return round2(d.lines.reduce((s, l) => s + round2(l.rate * l.quantity), 0) + d.taxAmount);
}
