import "server-only";
import { prisma } from "@/lib/db";
import type { Currency } from "@/lib/generated/prisma/client";

/* Exchange rates from Yahoo Finance: symbol "HKD=X" quotes HKD per 1 USD.
   Refreshed daily by /api/cron/fx, on demand from Settings and the invoice
   forms, and whenever a page reads rates older than a day. */

const CURRENCIES: Exclude<Currency, "USD">[] = ["HKD", "CNY", "EUR", "SGD", "CNH"];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type FxSnapshot = { rates: Record<string, number>; updatedAt: string | null };

async function yahooPerUsd(currency: string): Promise<number> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${currency}=X?range=1d&interval=1d`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; STAR SAAS Invoice)" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status} for ${currency}.`);
  const body = (await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number } }[] } };
  const price = body.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price || !(price > 0)) throw new Error(`No Yahoo Finance quote for ${currency}.`);
  return price;
}

/** Pulls every currency; one failing symbol doesn't block the others. */
export async function refreshFxRates() {
  const results = await Promise.allSettled(CURRENCIES.map(async (c) => ({ currency: c, perUsd: await yahooPerUsd(c) })));
  const updated: { currency: string; perUsd: number }[] = [];
  const failed: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      failed.push(CURRENCIES[i]);
      continue;
    }
    const { currency, perUsd } = r.value;
    await prisma.fxRate.upsert({
      where: { currency },
      update: { usdPerUnit: 1 / perUsd, source: "YAHOO" },
      create: { currency, usdPerUnit: 1 / perUsd, source: "YAHOO" },
    });
    updated.push({ currency, perUsd });
  }
  return { updated, failed };
}

async function snapshot(): Promise<FxSnapshot & { oldest: Date | null }> {
  const rows = await prisma.fxRate.findMany();
  const rates: Record<string, number> = { USD: 1 };
  for (const r of rows) rates[r.currency] = Number(r.usdPerUnit);
  const times = rows.map((r) => r.updatedAt.getTime());
  return {
    rates,
    updatedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    oldest: times.length ? new Date(Math.min(...times)) : null,
  };
}

/** Current rates, refreshed first when any is missing or older than a day.
 *  Falls back to the stored rates if Yahoo is unreachable. */
let lastAttempt = 0;
const RETRY_MS = 10 * 60 * 1000;

export async function freshFxRates(): Promise<FxSnapshot> {
  let snap = await snapshot();
  const stale = !snap.oldest || Date.now() - snap.oldest.getTime() > MAX_AGE_MS || CURRENCIES.some((c) => !snap.rates[c]);
  if (stale && Date.now() - lastAttempt > RETRY_MS) {
    lastAttempt = Date.now();
    try {
      await refreshFxRates();
      snap = await snapshot();
    } catch {
      // keep stored rates
    }
  }
  return { rates: snap.rates, updatedAt: snap.updatedAt };
}
