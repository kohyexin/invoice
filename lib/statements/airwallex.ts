import { splitMonths } from "./months";
import type { ParsedStatement, StatementEntry } from "./types";

/* Airwallex "Balance Activity Report" CSVs: every wallet of the account for the date
   range picked, oldest first. Card holds and their releases are rows too; the
   Available Balance after each row follows from all of them, the way the cash book
   books them. Lines are keyed by Transaction Id plus the row type, because a hold,
   its release and the purchase share one id, as do a payout and its fee. */

const BANK_NAME = "Airwallex";
const COLUMNS = {
  time: "Time",
  type: "Financial Transaction Type",
  id: "Transaction Id",
  description: "Description",
  currency: "Wallet Currency",
  debit: "Debit Net Amount",
  credit: "Credit Net Amount",
  balance: "Available Balance",
  accountName: "Account Name",
  accountId: "Account Id",
  entity: "Legal Entity",
} as const;
const OPTIONAL = new Set<string>([COLUMNS.accountName, COLUMNS.entity]);

type Cell = string | number | boolean | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: Cell) => String(v ?? "").trim();
const money = (v: Cell) => (typeof v === "number" ? round2(v) : round2(Number(text(v).replace(/,/g, "")) || 0));
const upper = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
const MONTH_TAIL = /\s+(?:MID\s+)?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)$/i;

export function isAirwallex(rows: Cell[][]) {
  const head = (rows[0] ?? []).map(text);
  return head.includes(COLUMNS.type) && head.includes(COLUMNS.balance) && head.includes(COLUMNS.id);
}

/** "SIMBATELECOM*129457508, 0088255942, SGP, (…)" -> "SIMBATELECOM"; "ONE*boonbuy com" -> "BOONBUY COM". */
function merchantOf(description: string) {
  let m = description.split(",")[0].trim();
  const star = m.match(/^([^*#]+)[*#]\s*(.*)$/);
  if (star) m = star[1].trim().length <= 3 && star[2] ? star[2] : star[1];
  return upper(m.replace(/-G\d+$/i, "").replace(MONTH_TAIL, ""));
}

/** The payer or payee, so the same party is recognised on later downloads. */
export function counterpartyOf(type: string, description: string) {
  const d = description.replace(/\s+/g, " ").trim();
  const pick = (re: RegExp) => d.match(re)?.[1];
  switch (type) {
    case "DEPOSIT":
      return upper(d.split("|")[0]);
    case "DC_CREDIT":
      return upper(pick(/received from (.+?)'s Airwallex wallet/i) ?? d);
    case "PAYOUT":
    case "DC_DEBIT":
      return upper(pick(/^Pay (.+?) [\d,]+(?:\.\d+)? [A-Z]{3}\b/) ?? d);
    case "FEE":
    case "PAYOUT_REFUND":
      return upper(pick(/ to (.+?) \(/) ?? d);
    case "ADJUSTMENT":
      return /rebate/i.test(d) ? "AIRWALLEX REBATE" : upper(d);
    default:
      return type.startsWith("CARD") ? merchantOf(d) : upper(d);
  }
}

/** Reads one report. Returns one statement per wallet currency and calendar month it touches. */
export function parseAirwallex(rows: Cell[][]): ParsedStatement[] {
  const head = (rows[0] ?? []).map(text);
  const col = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, name] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    col[key] = head.indexOf(name);
    if (col[key] < 0 && !OPTIONAL.has(name)) throw new Error(`The Airwallex report has no "${name}" column.`);
  }
  const body = rows.slice(1).filter((r) => text(r[col.id]) && text(r[col.time]));
  if (!body.length) throw new Error("The Airwallex report has no transactions.");
  const accounts = new Set(body.map((r) => text(r[col.accountId])));
  if (accounts.size > 1) throw new Error("The report mixes several Airwallex accounts; download one account at a time.");

  const seen = new Map<string, number>();
  const byCurrency = new Map<string, StatementEntry[]>();
  body.forEach((r, i) => {
    const time = text(r[col.time]);
    const date = time.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Unexpected time "${time}".`);
    const type = text(r[col.type]);
    const id = `${text(r[col.id])}:${type}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const description = text(r[col.description]);
    const currency = text(r[col.currency]).toUpperCase();
    const entry: StatementEntry = {
      date,
      description,
      debit: money(r[col.debit]),
      credit: money(r[col.credit]),
      isInterest: false,
      counterparty: counterpartyOf(type, description),
      ref: n > 1 ? `${id}:${n}` : id,
      balance: money(r[col.balance]),
      // Rows in the same second (a payout and its fee) keep the report's order.
      time: `${time}|${String(i).padStart(6, "0")}`,
    };
    byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), entry]);
  });

  const first = body[0];
  const accountName = text(first[col.entity]) || text(first[col.accountName]);
  return [...byCurrency.entries()].flatMap(([currency, entries]) =>
    splitMonths({ bank: "AIRWALLEX", bankName: BANK_NAME, accountNumber: text(first[col.accountId]), accountName, currency }, entries),
  );
}
