import type { ParsedStatement, StatementEntry } from "./types";

/* Industrial Bank (兴业银行) transaction downloads for the XMXY accounts: an Excel
   sheet for whatever date range was picked, newest first, one row per transaction
   with the balance after it. Each range is split into calendar months so it fits
   the monthly statement flow; lines are keyed by the bank's Unique Code, so
   overlapping downloads don't double anything. */

const BANK_NAME = "兴业银行";
const COLUMNS = {
  ref: "Unique Code",
  account: "Account",
  holder: "Holder Name",
  currency: "Currency",
  debit: "Debit Amount",
  credit: "Credit Amount",
  balance: "Account Balance",
  type: "Description",
  recipient: "Recipient Name",
  date: "Posting Date",
  time: "Date & Time",
  purpose: "Purpose",
  remarks: "Remarks",
} as const;

type Cell = string | number | boolean | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: Cell) => String(v ?? "").replace(/&amp;/g, "&").trim();
const header = (v: Cell) => text(v).replace(/\s+/g, " ");
const money = (v: Cell) => (typeof v === "number" ? round2(v) : round2(Number(text(v).replace(/,/g, "")) || 0));
const currencyOf = (v: string) => (/^(RMB|CNY)$/i.test(v) ? "CNY" : v.toUpperCase());
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const net = (e: StatementEntry) => round2(e.credit - e.debit);

function headerRow(rows: Cell[][]) {
  return rows.findIndex((r) => r.some((c) => header(c) === COLUMNS.ref) && r.some((c) => header(c) === COLUMNS.balance));
}

export function isCib(rows: Cell[][]) {
  const i = headerRow(rows);
  return i >= 0 && rows[i].some((c) => header(c) === COLUMNS.debit);
}

/** "待报解预算收入（TIPS系统）" + "435026…-个人所得税" -> "待报解预算收入（TIPS系统） 个人所得税". */
function counterpartyOf(recipient: string, type: string, remarks: string) {
  if (/TIPS/i.test(recipient)) {
    const tax = remarks.includes("-") ? remarks.slice(remarks.indexOf("-") + 1).trim() : "";
    return `${recipient}${tax ? ` ${tax}` : ""}`.toUpperCase();
  }
  return (recipient || type).replace(/\s+/g, " ").toUpperCase();
}

/** Reads one download. Returns one statement per calendar month it touches. */
export function parseCib(rows: Cell[][]): ParsedStatement[] {
  const h = headerRow(rows);
  if (h < 0) throw new Error("This doesn't look like an Industrial Bank download (no Unique Code / Account Balance columns).");
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    col[key] = rows[h].findIndex((c) => header(c) === name);
    if (col[key] < 0) throw new Error(`The download has no "${name}" column.`);
  }

  const body = rows.slice(h + 1).filter((r) => text(r[col.ref]));
  if (!body.length) throw new Error("The download has no transactions.");
  const accounts = new Set(body.map((r) => text(r[col.account])));
  const currencies = new Set(body.map((r) => currencyOf(text(r[col.currency]))));
  if (accounts.size > 1 || currencies.size > 1) throw new Error("The download mixes several accounts or currencies; download one account at a time.");

  checkSummary(rows.slice(0, h), body, col);

  const entries: StatementEntry[] = body.map((r) => {
    const type = text(r[col.type]);
    const purpose = text(r[col.purpose]);
    const remarks = text(r[col.remarks]);
    const date = text(r[col.date]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Unexpected posting date "${text(r[col.date])}".`);
    return {
      date,
      description: [type, purpose, remarks].filter(Boolean).join(" · "),
      debit: money(r[col.debit]),
      credit: money(r[col.credit]),
      isInterest: type === "存款利息",
      counterparty: counterpartyOf(text(r[col.recipient]), type, remarks),
      ref: text(r[col.ref]),
      balance: money(r[col.balance]),
      time: text(r[col.time]),
    };
  });

  const first = body[0];
  return cibMonths(
    {
      accountNumber: text(first[col.account]),
      accountName: text(first[col.holder]),
      currency: currencyOf(text(first[col.currency])),
    },
    entries,
    new Set(),
  );
}

/** Row 1 holds the count and totals: "本表总笔数：31 / 本表总收入金额：791662.32 / 本表总支出金额:745746.08". */
function checkSummary(top: Cell[][], body: Cell[][], col: Record<keyof typeof COLUMNS, number>) {
  const summary = top.flat().map(text).join("\n");
  const count = summary.match(/总笔数[:：]\s*(\d+)/)?.[1];
  const totalIn = summary.match(/总收入金额[:：]\s*([\d,.]+)/)?.[1];
  const totalOut = summary.match(/总支出金额[:：]\s*([\d,.]+)/)?.[1];
  if (count && Number(count) !== body.length) throw new Error(`The download says ${count} transactions but ${body.length} were read.`);
  const sum = (c: number) => round2(body.reduce((t, r) => t + money(r[c]), 0));
  if (totalIn && Math.abs(sum(col.credit) - money(totalIn)) >= 0.005) throw new Error(`Money in adds up to ${sum(col.credit).toFixed(2)}, but the download says ${money(totalIn).toFixed(2)}.`);
  if (totalOut && Math.abs(sum(col.debit) - money(totalOut)) >= 0.005) throw new Error(`Money out adds up to ${sum(col.debit).toFixed(2)}, but the download says ${money(totalOut).toFixed(2)}.`);
}

type Account = { accountNumber: string; accountName: string; currency: string };

/**
 * Oldest first, checks each balance follows from the one before, then groups by month.
 * Months between the first and last are complete; the first and last cover only the
 * dates with transactions unless `complete` (or a wider period passed in) says otherwise.
 */
function cibMonths(account: Account, entries: StatementEntry[], complete: Set<string>, periods = new Map<string, { start: string; end: string }>()) {
  const sorted = [...entries].sort((a, b) => (a.time ?? a.date).localeCompare(b.time ?? b.date) || (a.ref ?? "").localeCompare(b.ref ?? ""));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const e = sorted[i];
    if (Math.abs(round2(prev.balance! + net(e)) - e.balance!) >= 0.005) {
      throw new Error(
        `Balances don't follow on ${e.date}: ${prev.balance!.toFixed(2)} plus ${net(e).toFixed(2)} isn't ${e.balance!.toFixed(2)}. A transaction may be missing, e.g. a gap between two downloads.`,
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
      bank: "CIB",
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      accountType: "",
      bankName: BANK_NAME,
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

/** Combines months from several downloads of the same account: one copy of each transaction, widest period. */
export function mergeCib(statements: ParsedStatement[]): ParsedStatement[] {
  const groups = new Map<string, ParsedStatement[]>();
  for (const s of statements) {
    const k = `${s.accountNumber}:${s.sections[0].currency}`;
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
    out.push(...cibMonths({ accountNumber: first.accountNumber, accountName: first.accountName, currency: first.sections[0].currency }, [...byRef.values()], complete, periods));
  }
  return out;
}
