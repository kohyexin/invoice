import { splitMonths } from "./months";
import type { ParsedStatement, StatementEntry } from "./types";

/* Industrial Bank (兴业银行) transaction downloads for the XMXY accounts: an Excel
   sheet for whatever date range was picked, newest first, one row per transaction
   with the balance after it. Lines are keyed by the bank's Unique Code. Online
   banking exports the same columns with English or Chinese headers. */

const BANK_NAME = "兴业银行";
const COLUMNS = {
  ref: ["Unique Code", "唯一流水编号"],
  account: ["Account", "账号"],
  holder: ["Holder Name", "户名"],
  currency: ["Currency", "币种"],
  debit: ["Debit Amount", "借方金额(支出)"],
  credit: ["Credit Amount", "贷方金额(收入)"],
  balance: ["Account Balance", "账户余额"],
  type: ["Description", "摘要"],
  recipient: ["Recipient Name", "对方户名"],
  date: ["Posting Date", "记账日期"],
  time: ["Date & Time", "交易时间"],
  purpose: ["Purpose", "用途"],
  remarks: ["Remarks", "备注"],
} as const;

type Cell = string | number | boolean | null | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: Cell) => String(v ?? "").replace(/&amp;/g, "&").trim();
/** Fullwidth brackets and spacing vary between exports: "借方金额（支出）" = "借方金额(支出)". */
const header = (v: Cell) => text(v).replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, " ");
const is = (c: Cell, names: readonly string[]) => names.includes(header(c));
const money = (v: Cell) => (typeof v === "number" ? round2(v) : round2(Number(text(v).replace(/,/g, "")) || 0));
const CURRENCIES: Record<string, string> = { RMB: "CNY", CNY: "CNY", 人民币: "CNY", 美元: "USD", 港币: "HKD", 港元: "HKD", 欧元: "EUR" };
const currencyOf = (v: string) => CURRENCIES[v.toUpperCase()] ?? v.toUpperCase();
function headerRow(rows: Cell[][]) {
  return rows.findIndex((r) => r.some((c) => is(c, COLUMNS.ref)) && r.some((c) => is(c, COLUMNS.balance)));
}

export function isCib(rows: Cell[][]) {
  const i = headerRow(rows);
  return i >= 0 && rows[i].some((c) => is(c, COLUMNS.debit));
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
  for (const [key, names] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, readonly string[]][]) {
    col[key] = rows[h].findIndex((c) => is(c, names));
    if (col[key] < 0) throw new Error(`The download has no "${names[0]}" (${names[1]}) column.`);
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
  return splitMonths(
    {
      bank: "CIB",
      bankName: BANK_NAME,
      accountNumber: text(first[col.account]),
      accountName: text(first[col.holder]),
      currency: currencyOf(text(first[col.currency])),
    },
    entries,
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
