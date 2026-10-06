import "server-only";
import { prisma } from "@/lib/db";
import { round2 } from "@/lib/utils";
import { BALANCE_USES } from "@/lib/cash";
import type { ParsedStatement, StatementEntry } from "./types";

/* Compares statements with the cash book. Nothing here writes; the import
   page shows the result and applyStatements() inserts what was chosen. */

const MATCH_DAYS = 3;
const DAY = 86_400_000;

export type ProposedLine = {
  key: string;
  kind: "opening" | "interest" | "entry";
  accountId: string;
  /** yyyy-mm-dd */
  date: string;
  amountIn: number;
  amountOut: number;
  categoryId: string;
  purpose: string;
  party: string;
  memo: string;
  counterparty: string;
  /** Where the suggested category came from. */
  suggested: "history" | "rule" | "none";
};

export type MatchedEntry = {
  date: string;
  description: string;
  net: number;
  bookDate: string;
  bookPurpose: string;
  bookParty: string;
  bookCategoryId: string | null;
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
  opening: number;
  closing: number;
  /** Book balance before the period / at its end, from what is saved now. */
  baseOpening: number;
  baseClosing: number;
  /** Opening difference on a later statement; shown as a warning only. */
  openingWarning: number | null;
  interestTotal: number;
  interestAlready: boolean;
  matched: MatchedEntry[];
  proposed: ProposedLine[];
  bookOnly: BookOnly[];
};

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
  amountIn: unknown;
  amountOut: unknown;
  purpose: string;
  party: string;
  memo: string;
  categoryId: string | null;
  importKey: string | null;
};

type Hint = { categoryId: string | null; purpose: string; party: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const net = (l: BookLine) => round2(Number(l.amountIn) - Number(l.amountOut));
const isFixedKey = (key: string | null) => !!key && (key.endsWith(":interest") || key.endsWith(":opening"));
const sameText = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export async function reconcileStatements(
  files: { name: string; statement: ParsedStatement }[],
  accountChoices: Record<string, string> = {},
): Promise<Omit<StatementPreview, "errors">> {
  const [accounts, categories, dbHints] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { use: { in: [...BALANCE_USES] } },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, currency: true, accountNumber: true, accountName: true, bankName: true, accountType: true, accountLocation: true },
    }),
    prisma.cashCategory.findMany({ select: { id: true, nameZh: true } }),
    prisma.cashHint.findMany(),
  ]);
  const zijin = categories.find((c) => c.nameZh === "资金相关")?.id ?? "";

  const candidates: StatementPreview["candidates"] = {};
  for (const a of accounts) (candidates[a.currency] ??= []).push({ id: a.id, label: a.label });

  const hints = new Map<string, Hint>();
  for (const h of dbHints) hints.set(`${h.accountId}|${h.counterparty}|${h.direction}`, h);

  const books = new Map<string, BookLine[]>();
  const bookOf = async (accountId: string) => {
    if (!books.has(accountId)) {
      books.set(
        accountId,
        await prisma.cashTxn.findMany({
          where: { accountId },
          orderBy: [{ date: "asc" }, { seq: "asc" }],
          select: { id: true, date: true, amountIn: true, amountOut: true, purpose: true, party: true, memo: true, categoryId: true, importKey: true },
        }),
      );
    }
    return books.get(accountId)!;
  };

  const ordered = [...files].sort((a, b) => a.statement.periodStart.localeCompare(b.statement.periodStart));
  const months: MonthPreview[] = [];
  const details = new Map<string, AccountDetails>();
  /** Lines proposed by earlier months of this upload, per account. */
  const pending = new Map<string, ProposedLine[]>();
  const used = new Set<string>();

  for (const { name, statement: s } of ordered) {
    for (const section of s.sections) {
      if (!section.entries.length && !section.opening && !section.closing) continue;
      const choiceKey = `${s.accountNumber}:${section.currency}`;
      const account =
        accounts.find((a) => a.id === accountChoices[choiceKey]) ??
        accounts.find((a) => a.accountNumber.replace(/[\s-]/g, "") === s.accountNumber && a.currency === section.currency);
      const ym = s.periodStart.slice(0, 7);
      const prefix = `${s.bank}:${s.accountNumber}:${section.currency}:${ym}`;
      const interestTotal = round2(section.entries.filter((e) => e.isInterest).reduce((t, e) => t + e.credit - e.debit, 0));

      const month: MonthPreview = {
        id: prefix,
        file: name,
        bank: s.bank,
        accountNumber: s.accountNumber,
        currency: section.currency,
        accountId: account?.id ?? null,
        accountLabel: account?.label ?? "",
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        opening: section.opening,
        closing: section.closing,
        baseOpening: 0,
        baseClosing: 0,
        openingWarning: null,
        interestTotal,
        interestAlready: false,
        matched: [],
        proposed: [],
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
          label: account.label,
          fields: [
            field("accountName", "Account name", s.accountName),
            field("bankName", "Bank name", s.bankName),
            field("accountType", "Account type", s.accountType),
            field("accountNumber", "Account number", s.accountNumber),
            field("accountLocation", "Account location", s.accountLocation),
          ].filter((f) => f.statement),
        });
      }

      const book = await bookOf(account.id);
      const keys = new Set(book.map((l) => l.importKey).filter(Boolean) as string[]);
      const earlier = pending.get(account.id) ?? [];
      const start = utc(s.periodStart);
      const end = utc(s.periodEnd);
      const sumBook = (pred: (d: Date) => boolean) => round2(book.filter((l) => pred(l.date)).reduce((t, l) => t + net(l), 0));
      const sumPending = (pred: (d: Date) => boolean) => round2(earlier.filter((l) => pred(utc(l.date))).reduce((t, l) => t + l.amountIn - l.amountOut, 0));
      month.baseOpening = sumBook((d) => d < start);
      month.baseClosing = sumBook((d) => d <= end);

      const add = (line: Omit<ProposedLine, "accountId">) => {
        const full = { ...line, accountId: account.id };
        month.proposed.push(full);
        (pending.get(account.id) ?? pending.set(account.id, []).get(account.id)!).push(full);
      };

      // Opening: on the first statement for the account, bring the book to the bank's opening balance.
      const bookOpening = round2(month.baseOpening + sumPending((d) => d < start));
      const openingGap = round2(section.opening - bookOpening);
      const firstImport = !book.some((l) => l.importKey) && earlier.length === 0;
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
            counterparty: "",
            suggested: "rule",
          });
        } else if (!firstImport) {
          month.openingWarning = openingGap;
        }
      }

      // Ordinary entries: match to book lines on amount and direction within a few days.
      const seen = new Map<string, number>();
      const periodMatched = new Set<string>();
      for (const e of section.entries.filter((x) => !x.isInterest)) {
        const amount = round2(e.credit - e.debit);
        const at = utc(e.date);
        const best = book
          .filter((l) => !used.has(l.id) && !isFixedKey(l.importKey) && net(l) === amount && Math.abs(l.date.getTime() - at.getTime()) <= MATCH_DAYS * DAY)
          .sort((a, b) => Math.abs(a.date.getTime() - at.getTime()) - Math.abs(b.date.getTime() - at.getTime()))[0];
        const dir = amount >= 0 ? "in" : "out";
        if (best) {
          used.add(best.id);
          periodMatched.add(best.id);
          hints.set(`${account.id}|${e.counterparty}|${dir}`, { categoryId: best.categoryId, purpose: best.purpose, party: best.party });
          month.matched.push({ date: e.date, description: e.description, net: amount, bookDate: iso(best.date), bookPurpose: best.purpose, bookParty: best.party, bookCategoryId: best.categoryId, counterparty: e.counterparty });
          continue;
        }
        const n = (seen.get(`${e.date}:${amount}`) ?? 0) + 1;
        seen.set(`${e.date}:${amount}`, n);
        add(entryLine(prefix, e, amount, n, hints.get(`${account.id}|${e.counterparty}|${dir}`)));
      }

      // Lines in the book for this period that the bank doesn't have.
      for (const l of book) {
        if (l.date < start || l.date > end || periodMatched.has(l.id) || used.has(l.id) || isFixedKey(l.importKey)) continue;
        month.bookOnly.push({ id: l.id, date: iso(l.date), purpose: l.purpose, party: l.party, memo: l.memo, net: net(l) });
      }

      // Interest: one line for the month.
      if (Math.abs(interestTotal) >= 0.005) {
        if (keys.has(`${prefix}:interest`)) {
          month.interestAlready = true;
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
            counterparty: "",
            suggested: "rule",
          });
        }
      }
    }
  }

  return { months, accounts: [...details.values()], candidates };
}

function entryLine(prefix: string, e: StatementEntry, amount: number, n: number, hint: Hint | undefined): Omit<ProposedLine, "accountId"> {
  return {
    key: `${prefix}:${e.date}:${amount.toFixed(2)}:${n}`,
    kind: "entry",
    date: e.date,
    amountIn: Math.max(amount, 0),
    amountOut: Math.max(-amount, 0),
    categoryId: hint?.categoryId ?? "",
    purpose: hint?.purpose || e.description,
    party: hint?.party || e.counterparty,
    memo: e.description,
    counterparty: e.counterparty,
    suggested: hint ? "history" : "none",
  };
}

function monthName(isoDate: string) {
  return utc(isoDate).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
