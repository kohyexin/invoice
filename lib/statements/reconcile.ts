import "server-only";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/utils";
import { BALANCE_USES } from "@/lib/cash";
import { accountName, accountNameWithCurrency } from "@/lib/account-name";
import { exactInvoices, invoiceNumbers, isInvoiceParty, openInvoices, type OpenInvoice } from "./invoices";
import type { ParsedStatement, SplitPattern, SplitRow, StatementEntry } from "./types";

/* Compares statements with the cash book and the approval queue. Nothing here
   writes; stageStatements() queues the proposed lines for approval. */

const MATCH_DAYS = 3;
const DAY = 86_400_000;
/** Open invoices of the payer's clients looked at when one receipt pays several. */
const LUMP_CANDIDATES = 12;

export type ProposedLine = {
  key: string;
  kind: "opening" | "interest" | "entry";
  accountId: string;
  /** yyyy-mm-dd */
  date: string;
  /** 使用月, yyyy-mm; earlier than the date when the counterparty is booked that way (salary). */
  period: string;
  amountIn: number;
  amountOut: number;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  /** The statement's own wording, for entries. */
  description: string;
  counterparty: string;
  /** Where the suggestion came from; "invoice" means unpaid invoices adding up to the receipt. */
  suggested: "invoice" | "history" | "rule" | "none";
  /** Receipts: the client paying and the invoices suggested (empty client when they span several). */
  clientId: string;
  invoiceIds: string[];
  /** Pre-split the way this counterparty was split last time. */
  splits: SplitRow[] | null;
};

export type MatchedEntry = {
  date: string;
  description: string;
  net: number;
  bookDate: string;
  bookPurpose: string;
  bookParty: string;
  bookCategoryId: string | null;
  bookPeriodLag: number;
  /** Set when the book has this bank line as several lines. */
  bookSplits: SplitPattern[] | null;
  counterparty: string;
};

export type BookOnly = { id: string; date: string; purpose: string; party: string; memo: string; net: number };

export type MonthPreview = {
  id: string;
  file: string;
  bank: string;
  accountNumber: string;
  currency: string;
  accountId: string | null;
  accountLabel: string;
  periodStart: string;
  periodEnd: string;
  /** The period covers only part of its month (date-range downloads). */
  partial: boolean;
  opening: number;
  closing: number;
  /** Book balance before the period / at its end, from what is saved now, less any amount held outside the statement. */
  baseOpening: number;
  baseClosing: number;
  /** Book balance at the period end once every waiting and newly queued line is approved. */
  closingAfterApproval: number;
  /** Money the book counts in this account that the statement doesn't show (e.g. Airwallex Yield). */
  offStatement: number;
  /** Opening difference on a later statement; shown as a warning only. */
  openingWarning: number | null;
  interestTotal: number;
  interestAlready: boolean;
  matched: MatchedEntry[];
  proposed: ProposedLine[];
  /** Lines from this statement already waiting for approval, or rejected before. */
  waiting: number;
  rejected: number;
  /** Waiting entry lines that the cash book now has (e.g. added to Excel since). */
  caughtUp: string[];
  bookOnly: BookOnly[];
};

type QueueLine = { id: string; key: string; status: string; date: Date; amountIn: unknown; amountOut: unknown };

export type DetailField = { key: "accountName" | "bankName" | "accountType" | "accountNumber" | "accountLocation"; label: string; current: string; statement: string; tick: boolean };
export type AccountDetails = { accountId: string; label: string; fields: DetailField[] };

export type StatementPreview = {
  months: MonthPreview[];
  accounts: AccountDetails[];
  /** Balance-sheet accounts per currency, for statements whose account number isn't in Settings yet. */
  candidates: Record<string, { id: string; label: string }[]>;
  errors: { file: string; message: string }[];
};

type BookLine = {
  id: string;
  date: Date;
  period: Date;
  amountIn: unknown;
  amountOut: unknown;
  purpose: string;
  party: string;
  memo: string;
  categoryId: string | null;
  importKey: string | null;
};

type Hint = { categoryId: string | null; purpose: string; party: string; periodLag: number; splits: SplitPattern[] | null };
/** A line to propose; without a period it belongs to the month of its date. */
type NewLine = Omit<ProposedLine, "accountId" | "period" | "clientId" | "invoiceIds" | "splits"> &
  Partial<Pick<ProposedLine, "clientId" | "invoiceIds" | "splits">> & { period?: string };
/** Invoices a receipt pays: one client, or several when an exact set spans them. */
type InvoicePick = { clientId: string; invoices: OpenInvoice[]; categoryId: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Months from `period` to `date`: 1 when August's salary is paid in September. */
export const periodLag = (date: Date, period: Date) => (date.getUTCFullYear() - period.getUTCFullYear()) * 12 + date.getUTCMonth() - period.getUTCMonth();
/** yyyy-mm of the month `lag` months before `date` (yyyy-mm-dd). */
const monthBefore = (date: string, lag: number) => {
  const d = utc(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - lag, 1)).toISOString().slice(0, 7);
};
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const net = (l: BookLine) => round2(Number(l.amountIn) - Number(l.amountOut));
const isFixedKey = (key: string | null) => !!key && (key.endsWith(":interest") || key.endsWith(":opening"));
/** Split rows are keyed "<line key>#2", "#3"…; the first keeps the line's key. */
export const baseKey = (key: string) => key.replace(/#\d+$/, "");
const sameText = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const squash = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
/** Airwallex rows that can pay invoices; card rows, refunds, holds and rebates can't. */
const AIRWALLEX_RECEIPT = /:(DEPOSIT|DC_CREDIT)(:\d+)?$/;

/** How book lines were split, for suggesting the same split next time. */
export function splitPatternOf(rows: { categoryId: string | null; purpose: string; party: string; memo: string; amountIn: unknown; amountOut: unknown }[], description: string): SplitPattern[] {
  return rows.map((r) => ({
    categoryId: r.categoryId ?? "",
    purpose: r.purpose,
    party: isInvoiceParty(r.party) ? "" : r.party,
    memo: squash(r.memo) === squash(description) ? "" : r.memo,
    direction: Number(r.amountIn) > 0 ? "in" : "out",
  }));
}

/** Rows from a remembered split: the first row in the bank line's direction takes the whole amount. */
function splitRowsFrom(pattern: SplitPattern[], amount: number, description: string): SplitRow[] {
  const dir = amount >= 0 ? "in" : "out";
  const lead = Math.max(0, pattern.findIndex((p) => p.direction === dir));
  return pattern.map((p, i) => ({
    categoryId: p.categoryId,
    purpose: p.purpose,
    party: p.party,
    memo: p.memo || description,
    amountIn: i === lead && amount > 0 ? amount : 0,
    amountOut: i === lead && amount < 0 ? -amount : 0,
  }));
}

export async function reconcileStatements(
  files: { name: string; statement: ParsedStatement }[],
  accountChoices: Record<string, string> = {},
): Promise<Omit<StatementPreview, "errors">> {
  const [accounts, categories, dbHints, unpaid, waitingParties] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { use: { in: [...BALANCE_USES] } },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, currency: true, accountNumber: true, accountName: true, bankName: true, accountType: true, accountLocation: true, offStatement: true },
    }),
    prisma.cashCategory.findMany({ select: { id: true, nameZh: true } }),
    prisma.cashHint.findMany(),
    prisma.invoice.findMany({
      where: { status: "SENT" },
      select: { id: true, number: true, currency: true, amount: true, amountPaid: true, alias: true, clientId: true, invoiceDate: true },
    }),
    prisma.statementLine.findMany({ where: { status: "PENDING" }, select: { party: true } }),
  ]);
  const zijin = categories.find((c) => c.nameZh === "资金相关")?.id ?? "";
  const income = categories.find((c) => c.nameZh === "营业收入")?.id ?? "";
  const isAirwallex = (a: { label: string; bankName: string }) => /airwallex/i.test(`${a.label} ${a.bankName}`);
  const airwallexIds = accounts.filter(isAirwallex).map((a) => a.id);

  // Each unpaid invoice is offered to one receipt only, and not if a waiting line already names it.
  const open = openInvoices(unpaid);
  const claimed = new Set(waitingParties.flatMap((l) => invoiceNumbers(l.party)));
  const clientsOf = new Map<string, string[]>();
  const clientsFor = async (party: string) => {
    if (!clientsOf.has(party)) {
      const numbers = invoiceNumbers(party);
      const rows = numbers.length ? await prisma.invoice.findMany({ where: { number: { in: numbers } }, select: { clientId: true } }) : [];
      clientsOf.set(party, [...new Set(rows.map((r) => r.clientId))]);
    }
    return clientsOf.get(party)!;
  };
  /**
   * One invoice for the exact amount (the payer's usual client first, then the oldest); else the
   * fewest of the payer's clients' oldest invoices adding up exactly; else, for a single client,
   * its oldest invoices while the receipt covers them, the rest becoming credit.
   */
  const invoicesFor = async (currency: string, amount: number, hint: Hint | undefined): Promise<InvoicePick | undefined> => {
    const usual = hint?.party ? await clientsFor(hint.party) : [];
    const free = open.filter((i) => i.currency === currency && i.due > 0 && !claimed.has(i.number));
    const pick = (invoices: OpenInvoice[]) => {
      const clients = new Set(invoices.map((i) => i.clientId));
      return { clientId: clients.size === 1 ? invoices[0].clientId : "", invoices, categoryId: income };
    };
    const single = free.filter((i) => i.due === amount);
    if (single.length) {
      return pick([single.sort((a, b) => Number(usual.includes(b.clientId)) - Number(usual.includes(a.clientId)) || a.invoiceDate.getTime() - b.invoiceDate.getTime())[0]]);
    }
    if (!usual.length) return undefined;
    const mine = free
      .filter((i) => usual.includes(i.clientId))
      .sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime() || a.number.localeCompare(b.number))
      .slice(0, LUMP_CANDIDATES);
    const exact = exactInvoices(mine, amount);
    if (exact) return pick(exact);
    if (usual.length !== 1) return undefined;
    const fill: OpenInvoice[] = [];
    let left = amount;
    for (const i of mine) {
      if (i.due > left + 0.005) break;
      fill.push(i);
      left = round2(left - i.due);
    }
    return fill.length ? pick(fill) : undefined;
  };

  const candidates: StatementPreview["candidates"] = {};
  for (const a of accounts) (candidates[a.currency] ??= []).push({ id: a.id, label: `${accountName(a)} (${a.label})` });

  const hints = new Map<string, Hint>();
  for (const h of dbHints) hints.set(`${h.accountId}|${h.counterparty}|${h.direction}`, { ...h, splits: (h.splits as SplitPattern[] | null) ?? null });

  const books = new Map<string, BookLine[]>();
  const bookOf = async (accountId: string) => {
    if (!books.has(accountId)) {
      books.set(
        accountId,
        await prisma.cashTxn.findMany({
          where: { accountId },
          orderBy: [{ date: "asc" }, { seq: "asc" }],
          select: { id: true, date: true, period: true, amountIn: true, amountOut: true, purpose: true, party: true, memo: true, categoryId: true, importKey: true },
        }),
      );
    }
    return books.get(accountId)!;
  };
  const queues = new Map<string, QueueLine[]>();
  const queueOf = async (accountId: string) => {
    if (!queues.has(accountId)) {
      queues.set(
        accountId,
        await prisma.statementLine.findMany({
          where: { accountId },
          select: { id: true, key: true, status: true, date: true, amountIn: true, amountOut: true },
        }),
      );
    }
    return queues.get(accountId)!;
  };

  const ordered = [...files].sort((a, b) => a.statement.periodStart.localeCompare(b.statement.periodStart));
  const months: MonthPreview[] = [];
  const details = new Map<string, AccountDetails>();
  /** Lines waiting for approval plus those proposed by earlier months of this upload, per account. */
  const pending = new Map<string, { date: string; amountIn: number; amountOut: number }[]>();
  const used = new Set<string>();

  for (const { name, statement: s } of ordered) {
    for (const section of s.sections) {
      if (!section.entries.length && !section.opening && !section.closing) continue;
      const choiceKey = `${s.accountNumber}:${section.currency}`;
      const account =
        accounts.find((a) => a.id === accountChoices[choiceKey]) ??
        accounts.find((a) => a.accountNumber.replace(/[\s-]/g, "") === s.accountNumber && a.currency === section.currency) ??
        // Airwallex reports name the platform account, not each wallet: one Airwallex balance account per currency.
        (s.bank === "AIRWALLEX" ? accounts.find((a) => a.currency === section.currency && isAirwallex(a)) : undefined);
      const ym = s.periodStart.slice(0, 7);
      const prefix = `${s.bank}:${s.accountNumber}:${section.currency}:${ym}`;
      // Banks that give each transaction an id: every line, interest included, is keyed and matched on its own.
      const hasRefs = section.entries.some((e) => e.ref);
      const interestTotal = hasRefs ? 0 : round2(section.entries.filter((e) => e.isInterest).reduce((t, e) => t + e.credit - e.debit, 0));
      const off = account ? round2(Number(account.offStatement)) : 0;

      const month: MonthPreview = {
        id: prefix,
        file: name,
        bank: s.bank,
        accountNumber: s.accountNumber,
        currency: section.currency,
        accountId: account?.id ?? null,
        accountLabel: account ? accountNameWithCurrency(account) : "",
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        partial: !!s.partial,
        opening: section.opening,
        closing: section.closing,
        baseOpening: 0,
        baseClosing: 0,
        closingAfterApproval: 0,
        offStatement: off,
        openingWarning: null,
        interestTotal,
        interestAlready: false,
        matched: [],
        proposed: [],
        waiting: 0,
        rejected: 0,
        caughtUp: [],
        bookOnly: [],
      };
      months.push(month);
      if (!account) continue;

      if (!details.has(account.id)) {
        const field = (key: DetailField["key"], label: string, statement: string): DetailField => {
          const current = String(account[key] ?? "");
          return { key, label, current, statement, tick: !!statement && !sameText(current, statement) };
        };
        details.set(account.id, {
          accountId: account.id,
          label: accountNameWithCurrency(account),
          fields: [
            field("accountName", "Account name", s.accountName),
            field("bankName", "Bank name", s.bankName),
            field("accountType", "Account type", s.accountType),
            // An Airwallex report's account id isn't any wallet's account number.
            field("accountNumber", "Account number", s.bank === "AIRWALLEX" ? "" : s.accountNumber),
            field("accountLocation", "Account location", s.accountLocation),
          ].filter((f) => f.statement),
        });
      }

      const book = await bookOf(account.id);
      const queue = await queueOf(account.id);
      const queued = new Map(queue.map((q) => [q.key, q]));
      const keys = new Set([...(book.map((l) => l.importKey && baseKey(l.importKey)).filter(Boolean) as string[]), ...queued.keys()]);
      const keyed = new Map<string, BookLine[]>();
      for (const l of book) if (l.importKey) keyed.set(baseKey(l.importKey), [...(keyed.get(baseKey(l.importKey)) ?? []), l]);
      // Lines waiting for approval count as booked when checking balances.
      if (!pending.has(account.id)) {
        pending.set(
          account.id,
          queue.filter((q) => q.status === "PENDING").map((q) => ({ date: iso(q.date), amountIn: Number(q.amountIn), amountOut: Number(q.amountOut) })),
        );
      }
      const earlier = pending.get(account.id)!;
      const start = utc(s.periodStart);
      const end = utc(s.periodEnd);
      const sumBook = (pred: (d: Date) => boolean) => round2(book.filter((l) => pred(l.date)).reduce((t, l) => t + net(l), 0));
      const sumPending = (pred: (d: Date) => boolean) => round2(earlier.filter((l) => pred(utc(l.date))).reduce((t, l) => t + l.amountIn - l.amountOut, 0));
      month.baseOpening = round2(sumBook((d) => d < start) - off);
      month.baseClosing = round2(sumBook((d) => d <= end) - off);
      for (const q of queue) {
        if (!q.key.startsWith(`${prefix}:`)) continue;
        if (q.status === "PENDING") month.waiting++;
        if (q.status === "REJECTED") month.rejected++;
      }

      const add = (line: NewLine) => {
        month.proposed.push({ clientId: "", invoiceIds: [], splits: null, ...line, period: line.period ?? line.date.slice(0, 7), accountId: account.id });
        earlier.push({ date: line.date, amountIn: line.amountIn, amountOut: line.amountOut });
      };

      // Opening: on the first statement for the account, bring the book to the bank's opening balance.
      const bookOpening = round2(month.baseOpening + sumPending((d) => d < start));
      const openingGap = round2(section.opening - bookOpening);
      const firstImport = !book.some((l) => l.importKey) && queue.length === 0 && !months.some((m) => m !== month && m.accountId === account.id);
      if (Math.abs(openingGap) >= 0.005) {
        if (firstImport && !keys.has(`${prefix}:opening`)) {
          const before = new Date(start.getTime() - DAY);
          add({
            key: `${prefix}:opening`,
            kind: "opening",
            date: iso(before),
            amountIn: Math.max(openingGap, 0),
            amountOut: Math.max(-openingGap, 0),
            categoryId: zijin,
            purpose: "存款利息",
            party: "",
            memo: `Interest before ${monthName(s.periodStart)}, not recorded line by line; brings the book to the statement opening balance`,
            description: "",
            counterparty: "",
            suggested: "rule",
          });
        } else if (!firstImport) {
          month.openingWarning = openingGap;
        }
      }

      const nearBy = (at: Date) => (l: BookLine) => !used.has(l.id) && !isFixedKey(l.importKey) && Math.abs(l.date.getTime() - at.getTime()) <= MATCH_DAYS * DAY;
      /** 2 or 3 book lines on one day that add up to the entry, one of them carrying the bank's wording (Ethoca). */
      const splitMatch = (e: StatementEntry, amount: number, at: Date): BookLine[] | undefined => {
        const near = book.filter(nearBy(at));
        const own = (l: BookLine) => squash(l.memo) === squash(e.description) || (!!e.counterparty && squash(l.memo).includes(e.counterparty));
        const days = [...new Set(near.filter(own).map((l) => iso(l.date)))];
        for (const day of days) {
          const list = near.filter((l) => iso(l.date) === day).slice(0, 16);
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const two = round2(net(list[i]) + net(list[j]));
              if (two === amount && (own(list[i]) || own(list[j]))) return [list[i], list[j]].sort((a, b) => Number(own(b)) - Number(own(a)));
              for (let k = j + 1; k < list.length; k++) {
                if (round2(two + net(list[k])) === amount && [list[i], list[j], list[k]].some(own)) return [list[i], list[j], list[k]].sort((a, b) => Number(own(b)) - Number(own(a)));
              }
            }
          }
        }
        return undefined;
      };

      // Ordinary entries: match to book lines on amount and direction within a few days.
      const seen = new Map<string, number>();
      const periodMatched = new Set<string>();
      for (const e of section.entries.filter((x) => hasRefs || !x.isInterest)) {
        const amount = round2(e.credit - e.debit);
        const n = (seen.get(`${e.date}:${amount}`) ?? 0) + 1;
        seen.set(`${e.date}:${amount}`, n);
        const key = e.ref ? `${prefix}:ref:${e.ref}` : entryKey(prefix, e.date, amount, n);
        const inQueue = queued.get(key);
        const at = utc(e.date);
        const dir = amount >= 0 ? "in" : "out";
        // Lines approved from this entry before (several when it was split) are its match.
        const approved = keyed.get(key)?.filter((l) => !used.has(l.id));
        const best = approved?.length
          ? approved
          : (() => {
              const one = book.filter((l) => nearBy(at)(l) && net(l) === amount).sort((a, b) => Math.abs(a.date.getTime() - at.getTime()) - Math.abs(b.date.getTime() - at.getTime()))[0];
              return one ? [one] : splitMatch(e, amount, at);
            })();
        if (best?.length) {
          for (const l of best) {
            used.add(l.id);
            periodMatched.add(l.id);
          }
          const lead = best[0];
          const lag = periodLag(lead.date, lead.period);
          const bookSplits = best.length > 1 ? splitPatternOf(best, e.description) : null;
          hints.set(`${account.id}|${e.counterparty}|${dir}`, { categoryId: lead.categoryId, purpose: lead.purpose, party: lead.party, periodLag: lag, splits: bookSplits });
          month.matched.push({
            date: e.date,
            description: e.description,
            net: amount,
            bookDate: iso(lead.date),
            bookPurpose: lead.purpose,
            bookParty: lead.party,
            bookCategoryId: lead.categoryId,
            bookPeriodLag: lag,
            bookSplits,
            counterparty: e.counterparty,
          });
          if (inQueue?.status === "PENDING" && lead.importKey !== key) {
            month.caughtUp.push(inQueue.id);
            const i = earlier.findIndex((l) => l.date === iso(inQueue.date) && round2(l.amountIn - l.amountOut) === amount);
            if (i >= 0) earlier.splice(i, 1);
          }
          continue;
        }
        if (keys.has(key)) continue;
        if (e.isInterest) {
          add(interestLine(key, e, amount, zijin));
          continue;
        }
        let hint = hints.get(`${account.id}|${e.counterparty}|${dir}`);
        // A refund or release is booked like the payment it reverses, which may have left another wallet.
        if (!hint && s.bank === "AIRWALLEX" && dir === "in") {
          hint = hints.get(`${account.id}|${e.counterparty}|out`) ?? airwallexIds.map((id) => hints.get(`${id}|${e.counterparty}|out`)).find(Boolean);
        }
        const mayPay = amount > 0 && !hint?.splits && (s.bank !== "AIRWALLEX" || AIRWALLEX_RECEIPT.test(e.ref ?? ""));
        const invoices = mayPay ? await invoicesFor(section.currency, amount, hint) : undefined;
        for (const i of invoices?.invoices ?? []) claimed.add(i.number);
        add(entryLine(key, e, amount, s.bank, hint, invoices));
      }

      // Lines in the book for this period that the bank doesn't have.
      for (const l of book) {
        if (l.date < start || l.date > end || periodMatched.has(l.id) || used.has(l.id) || isFixedKey(l.importKey)) continue;
        month.bookOnly.push({ id: l.id, date: iso(l.date), purpose: l.purpose, party: l.party, memo: l.memo, net: net(l) });
      }

      // Interest: one line for the month.
      if (Math.abs(interestTotal) >= 0.005) {
        if (keys.has(`${prefix}:interest`)) {
          month.interestAlready = queued.get(`${prefix}:interest`)?.status !== "REJECTED";
        } else {
          add({
            key: `${prefix}:interest`,
            kind: "interest",
            date: s.periodEnd,
            amountIn: Math.max(interestTotal, 0),
            amountOut: Math.max(-interestTotal, 0),
            categoryId: zijin,
            purpose: "存款利息",
            party: "",
            memo: `Interest Earned, ${monthName(s.periodStart)} (${s.bank} statement)`,
            description: "",
            counterparty: "",
            suggested: "rule",
          });
        }
      }
      month.closingAfterApproval = round2(month.baseClosing + sumPending((d) => d <= end));
    }
  }

  return { months, accounts: [...details.values()], candidates };
}

function entryKey(prefix: string, date: string, amount: number, n: number) {
  return `${prefix}:${date}:${amount.toFixed(2)}:${n}`;
}

/**
 * The suggested booking. Airwallex lines keep the bank's wording as the memo and the client alias
 * as the purpose, as the workbook does; other banks put the payer in the purpose and the alias in
 * the memo. Invoice numbers on earlier receipts belong to those receipts and aren't repeated.
 */
function entryLine(key: string, e: StatementEntry, amount: number, bank: string, hint: Hint | undefined, pick?: InvoicePick): NewLine {
  const alias = pick?.invoices[0]?.alias ?? "";
  const numbers = pick?.invoices.map((i) => i.number).join(", ") ?? "";
  const airwallex = bank === "AIRWALLEX";
  const staleParty = !!hint && amount > 0 && isInvoiceParty(hint.party);
  const splits = hint?.splits && hint.splits.length > 1 ? splitRowsFrom(hint.splits, amount, e.description) : null;
  const line: NewLine = {
    key,
    kind: "entry",
    date: e.date,
    period: monthBefore(e.date, hint?.periodLag ?? 0),
    amountIn: Math.max(amount, 0),
    amountOut: Math.max(-amount, 0),
    categoryId: hint?.categoryId || pick?.categoryId || "",
    purpose: airwallex ? hint?.purpose || alias || e.counterparty : hint?.purpose || (pick ? e.counterparty : "") || e.description,
    party: numbers || (staleParty ? "" : hint?.party || e.counterparty),
    memo: airwallex ? e.description : alias || e.description,
    description: e.description,
    counterparty: e.counterparty,
    suggested: pick ? "invoice" : hint ? "history" : "none",
    clientId: pick?.clientId ?? "",
    invoiceIds: pick?.invoices.flatMap((i) => i.ids) ?? [],
    splits,
  };
  if (splits) Object.assign(line, { categoryId: splits[0].categoryId, purpose: splits[0].purpose, party: splits[0].party, memo: splits[0].memo });
  return line;
}

function interestLine(key: string, e: StatementEntry, amount: number, categoryId: string): NewLine {
  return {
    key,
    kind: "interest",
    date: e.date,
    amountIn: Math.max(amount, 0),
    amountOut: Math.max(-amount, 0),
    categoryId,
    purpose: "存款利息",
    party: "",
    memo: e.description,
    description: e.description,
    counterparty: e.counterparty,
    suggested: "rule",
  };
}

function monthName(isoDate: string) {
  return utc(isoDate).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
