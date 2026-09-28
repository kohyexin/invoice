import "server-only";
import { prisma } from "@/lib/db";
import type { Currency } from "@/lib/generated/prisma/client";
import { round2 } from "@/lib/utils";

/** Pick the default payment account: company + currency beats company only,
 *  which beats currency only. */
export async function resolvePaymentAccountId(companyId: string | null, currency: Currency) {
  const rules = await prisma.paymentRule.findMany({
    where: {
      OR: [
        { companyId, currency },
        { companyId, currency: null },
        { companyId: null, currency },
      ],
    },
  });
  const score = (r: { companyId: string | null; currency: Currency | null }) =>
    (r.companyId ? 2 : 0) + (r.currency ? 1 : 0);
  const best = rules
    .filter((r) => (r.companyId === null || r.companyId === companyId) && (r.currency === null || r.currency === currency))
    .sort((a, b) => score(b) - score(a))[0];
  return best?.bankAccountId ?? null;
}

/** Manual invoice numbers follow the agreement: agreement SPP-22062024 gives
 *  22062024-001, 22062024-002, ... per client. */
export async function suggestInvoiceNumber(clientId: string) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { agreementNo: true },
  });
  const base = (client?.agreementNo ?? "").replace(/^[A-Za-z]+-/, "").trim();
  if (!base) return "";

  const existing = await prisma.invoice.findMany({
    where: { number: { startsWith: `${base}-` } },
    select: { number: true },
  });
  const maxSeq = existing.reduce((max, { number }) => {
    const seq = Number(number.slice(base.length + 1));
    return Number.isFinite(seq) ? Math.max(max, seq) : max;
  }, 0);
  return `${base}-${String(maxSeq + 1).padStart(3, "0")}`;
}

export async function fxRates(): Promise<Record<string, number>> {
  const rows = await prisma.fxRate.findMany();
  const map: Record<string, number> = { USD: 1 };
  for (const r of rows) map[r.currency] = Number(r.usdPerUnit);
  return map;
}

export function toUsd(amount: number, currency: string, rates: Record<string, number>) {
  const rate = currency === "USD" ? 1 : rates[currency];
  return rate ? round2(amount * rate) : null;
}
