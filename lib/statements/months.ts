import type { ParsedStatement, StatementEntry } from "./types";

/* Date-range downloads (Industrial Bank, Airwallex) give one row per transaction with
   the balance after it. They are split into calendar months so they fit the monthly
   statement flow; lines carry the bank's own id, so overlapping downloads don't
   double anything. */

export type RangeAccount = {
  bank: ParsedStatement["bank"];
  bankName: string;
  accountNumber: string;
  accountName: string;
  currency: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const net = (e: StatementEntry) => round2(e.credit - e.debit);
export const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Oldest first, checks each balance follows from the one before, then groups by month.
 * Months between the first and last are complete; the first and last cover only the
 * dates with transactions unless `complete` (or a wider period passed in) says otherwise.
 */
export function splitMonths(account: RangeAccount, entries: StatementEntry[], complete = new Set<string>(), periods = new Map<string, { start: string; end: string }>()) {
  const sorted = [...entries].sort((a, b) => (a.time ?? a.date).localeCompare(b.time ?? b.date) || (a.ref ?? "").localeCompare(b.ref ?? ""));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const e = sorted[i];
    if (Math.abs(round2(prev.balance! + net(e)) - e.balance!) >= 0.005) {
      throw new Error(
        `${account.currency} balances don't follow on ${e.date}: ${prev.balance!.toFixed(2)} plus ${net(e).toFixed(2)} isn't ${e.balance!.toFixed(2)}. A transaction may be missing, e.g. a gap between two downloads.`,
      );
    }
  }

  const months = [...new Set(sorted.map((e) => e.date.slice(0, 7)))];
  return months.map((ym, i): ParsedStatement => {
    const list = sorted.filter((e) => e.date.startsWith(ym));
    const whole = complete.has(ym) || (i > 0 && i < months.length - 1);
    const known = periods.get(ym);
    let start = whole ? `${ym}-01` : list[0].date;
    let end = whole ? lastDay(ym) : list[list.length - 1].date;
    if (known) {
      if (known.start < start) start = known.start;
      if (known.end > end) end = known.end;
    }
    return {
      bank: account.bank,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      accountType: "",
      bankName: account.bankName,
      accountLocation: "",
      periodStart: start,
      periodEnd: end,
      partial: !(start === `${ym}-01` && end === lastDay(ym)),
      sections: [
        {
          currency: account.currency,
          opening: round2(list[0].balance! - net(list[0])),
          closing: list[list.length - 1].balance!,
          entries: list,
        },
      ],
    };
  });
}

/** Combines months from several downloads of the same account and currency: one copy of each transaction, widest period. */
export function mergeMonths(statements: ParsedStatement[]): ParsedStatement[] {
  const groups = new Map<string, ParsedStatement[]>();
  for (const s of statements) {
    const k = `${s.bank}:${s.accountNumber}:${s.sections[0].currency}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: ParsedStatement[] = [];
  for (const list of groups.values()) {
    const byRef = new Map<string, StatementEntry>();
    const complete = new Set<string>();
    const periods = new Map<string, { start: string; end: string }>();
    for (const s of list) {
      const ym = s.periodStart.slice(0, 7);
      if (!s.partial) complete.add(ym);
      const p = periods.get(ym);
      periods.set(ym, { start: p && p.start < s.periodStart ? p.start : s.periodStart, end: p && p.end > s.periodEnd ? p.end : s.periodEnd });
      for (const e of s.sections[0].entries) byRef.set(e.ref!, e);
    }
    const first = list[0];
    out.push(
      ...splitMonths(
        { bank: first.bank, bankName: first.bankName, accountNumber: first.accountNumber, accountName: first.accountName, currency: first.sections[0].currency },
        [...byRef.values()],
        complete,
        periods,
      ),
    );
  }
  return out;
}
