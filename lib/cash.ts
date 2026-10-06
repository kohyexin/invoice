import "server-only";
import { prisma } from "@/lib/db";
import { freshFxRates } from "@/lib/fx";
import { round2 } from "@/lib/utils";
import { accountName, accountNameWithCurrency } from "@/lib/account-name";
import { SALARY_CATEGORY } from "@/lib/salary-parts";

const NAME_FIELDS = { label: true, currency: true, bankName: true, accountType: true, accountNumber: true } as const;

/* Cash book figures. Lines are kept in the account's currency; USD is
   worked out once per currency total with the latest rate. */

export const BALANCE_USES = ["BALANCE", "BOTH"] as const;

export type Rates = Record<string, number>;

/** USD for a per-currency total. Unknown currencies count as zero rather than 1:1. */
export function toUsd(totals: Record<string, number>, rates: Rates) {
  return Object.entries(totals).reduce((s, [cur, amount]) => s + amount * (rates[cur] ?? 0), 0);
}

export type CashAccountRow = {
  id: string;
  /** Bank and last four digits, e.g. "ANEXT Business Account ··6601". */
  name: string;
  /** Short nickname from the workbook, e.g. "SGD (ANEXT)". */
  label: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  currency: string;
  companyId: string;
  company: string;
  active: boolean;
  balance: number;
  usd: number;
  lines: number;
  lastDate: string | null;
};

export async function loadCashAccounts() {
  const [accounts, sums, fx] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { use: { in: [...BALANCE_USES] } },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      include: { company: { select: { id: true, legalName: true, sortOrder: true } } },
    }),
    prisma.cashTxn.groupBy({
      by: ["accountId"],
      _sum: { amountIn: true, amountOut: true },
      _count: { _all: true },
      _max: { date: true },
    }),
    freshFxRates(),
  ]);
  const byAccount = new Map(sums.map((s) => [s.accountId, s]));
  const rows: CashAccountRow[] = accounts.map((a) => {
    const s = byAccount.get(a.id);
    const balance = round2(Number(s?._sum.amountIn ?? 0) - Number(s?._sum.amountOut ?? 0));
    return {
      id: a.id,
      name: accountName(a),
      label: a.label,
      bankName: a.bankName,
      accountName: a.accountName,
      accountNumber: a.accountNumber,
      currency: a.currency,
      companyId: a.company?.id ?? "",
      company: a.company?.legalName ?? "",
      active: a.active,
      balance,
      usd: balance * (fx.rates[a.currency] ?? 0),
      lines: s?._count._all ?? 0,
      lastDate: s?._max.date?.toISOString() ?? null,
    };
  });
  return { accounts: rows, rates: fx.rates, ratesUpdatedAt: fx.updatedAt };
}

export type MonthlyLine = {
  id: string;
  date: string;
  /** yyyy-mm when the line was banked in a different month. */
  otherMonth: string;
  account: string;
  currency: string;
  purpose: string;
  party: string;
  memo: string;
  net: number;
  usd: number;
  invoice: { id: string; number: string } | null;
};

export type MonthlyCategory = {
  id: string;
  name: string;
  nameEn: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER" | "NONE";
  /** Net in USD: money in minus money out. */
  usd: number;
  /** Net per currency, before conversion. */
  native: Record<string, number>;
  byPurpose: { purpose: string; usd: number; count: number }[];
  lines: MonthlyLine[];
};

const monthStart = (ym: string) => new Date(`${ym}-01T00:00:00.000Z`);
const nextMonth = (ym: string) => {
  const d = monthStart(ym);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

/** yyyy-mm of every month from the first cash line to the last. */
export async function cashMonths() {
  const range = await prisma.cashTxn.aggregate({ _min: { date: true, period: true }, _max: { date: true, period: true } });
  if (!range._min.date || !range._max.date || !range._min.period || !range._max.period) return [];
  const out: string[] = [];
  const first = range._min.period < range._min.date ? range._min.period : range._min.date;
  const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const last = range._max.period > range._max.date ? range._max.period : range._max.date;
  while (d <= last) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out.reverse();
}

async function totalsByCurrency(before: Date) {
  const rows = await prisma.$queryRaw<{ currency: string; net: unknown }[]>`
    SELECT b."currency"::text AS currency, SUM(t."amountIn" - t."amountOut") AS net
    FROM "CashTxn" t JOIN "BankAccount" b ON b.id = t."accountId"
    WHERE t."date" < ${before}
    GROUP BY b."currency"`;
  return Object.fromEntries(rows.map((r) => [r.currency, Number(r.net)]));
}

export async function loadMonthlyStatement(ym: string) {
  const from = monthStart(ym);
  const to = nextMonth(ym);
  const [fx, opening, closing, txns, categories, issued, received, unpaid] = await Promise.all([
    freshFxRates(),
    totalsByCurrency(from),
    totalsByCurrency(to),
    // Income and expenses follow 使用月; opening and closing follow the bank date.
    prisma.cashTxn.findMany({
      where: { period: from },
      orderBy: [{ date: "asc" }, { seq: "asc" }, { createdAt: "asc" }],
      include: {
        account: { select: NAME_FIELDS },
        invoice: { select: { id: true, number: true } },
      },
    }),
    prisma.cashCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }] }),
    prisma.invoice.aggregate({
      where: { invoiceDate: { gte: from, lt: to }, status: { not: "WAIVED" } },
      _sum: { usdAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.aggregate({
      where: { receivedDate: { gte: from, lt: to } },
      _sum: { receivedAmount: true },
      _count: { _all: true },
    }),
    // Unpaid at month end: issued by then and not yet received by then.
    prisma.invoice.aggregate({
      where: {
        invoiceDate: { lt: to },
        OR: [{ status: "SENT" }, { status: "PAID", receivedDate: { gte: to } }],
      },
      _sum: { usdAmount: true },
      _count: { _all: true },
    }),
  ]);
  const rates = fx.rates;

  const groups = new Map<string, MonthlyCategory>();
  for (const c of categories) {
    groups.set(c.id, { id: c.id, name: c.nameZh, nameEn: c.nameEn, kind: c.kind, usd: 0, native: {}, byPurpose: [], lines: [] });
  }
  const none: MonthlyCategory = { id: "", name: "Uncategorized", nameEn: "", kind: "NONE", usd: 0, native: {}, byPurpose: [], lines: [] };

  for (const t of txns) {
    const g = (t.categoryId && groups.get(t.categoryId)) || none;
    const net = Number(t.amountIn) - Number(t.amountOut);
    const cur = t.account.currency;
    g.native[cur] = (g.native[cur] ?? 0) + net;
    g.lines.push({
      id: t.id,
      date: t.date.toISOString(),
      otherMonth: t.date.toISOString().slice(0, 7) === ym ? "" : t.date.toISOString().slice(0, 7),
      account: accountNameWithCurrency(t.account),
      currency: cur,
      purpose: t.purpose,
      party: t.party,
      memo: t.memo,
      net,
      usd: net * (rates[cur] ?? 0),
      invoice: t.invoice,
    });
  }

  const list = [...groups.values(), none].filter((g) => g.lines.length > 0);
  for (const g of list) {
    g.usd = toUsd(g.native, rates);
    const purposes = new Map<string, { usd: number; count: number }>();
    for (const l of g.lines) {
      const key = l.purpose || "—";
      const p = purposes.get(key) ?? { usd: 0, count: 0 };
      p.usd += l.usd;
      p.count += 1;
      purposes.set(key, p);
    }
    g.byPurpose = [...purposes.entries()]
      .map(([purpose, p]) => ({ purpose, ...p }))
      .sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd));
  }

  const sum = (kind: MonthlyCategory["kind"]) => list.filter((g) => g.kind === kind).reduce((s, g) => s + g.usd, 0);
  const openingUsd = toUsd(opening, rates);
  const closingUsd = toUsd(closing, rates);
  const flows = list.reduce((s, g) => s + g.usd, 0);

  return {
    month: ym,
    rates,
    ratesUpdatedAt: fx.updatedAt,
    openingUsd,
    closingUsd,
    income: sum("INCOME"),
    /** Positive number: money spent. */
    expense: -sum("EXPENSE"),
    transfers: sum("TRANSFER"),
    uncategorized: sum("NONE"),
    /** Banked this month but used in another month, less used this month but banked in another. */
    timing: closingUsd - openingUsd - flows,
    categories: list,
    lineCount: txns.length,
    invoices: {
      issuedUsd: Number(issued._sum.usdAmount ?? 0),
      issuedCount: issued._count._all,
      receivedUsd: Number(received._sum.receivedAmount ?? 0),
      receivedCount: received._count._all,
      unpaidUsd: Number(unpaid._sum.usdAmount ?? 0),
      unpaidCount: unpaid._count._all,
    },
  };
}

export type MonthlyStatement = Awaited<ReturnType<typeof loadMonthlyStatement>>;

export type CashDashboard = {
  ratesUpdatedAt: string | null;
  /** Every month from the first cash line to this month. Closing follows the bank date; income and expense follow 使用月. */
  months: { month: string; closing: number; income: number; expense: number }[];
  currencies: { currency: string; native: number; usd: number }[];
  /** Expense categories over the 12 completed months before this one, as positive spend. */
  spending: { id: string; name: string; nameEn: string; usd: number; byPurpose: { purpose: string; usd: number }[] }[];
};

/** Month-by-month cash figures for the dashboard, all at today's rates. */
export async function loadCashDashboard(): Promise<CashDashboard> {
  const [fx, byDate, byPeriod, salary] = await Promise.all([
    freshFxRates(),
    prisma.$queryRaw<{ month: string; currency: string; net: unknown }[]>`
      SELECT to_char(t."date", 'YYYY-MM') AS month, b."currency"::text AS currency, SUM(t."amountIn" - t."amountOut") AS net
      FROM "CashTxn" t JOIN "BankAccount" b ON b.id = t."accountId"
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ month: string; currency: string; id: string | null; kind: string | null; nameZh: string | null; nameEn: string | null; net: unknown }[]>`
      SELECT to_char(t."period", 'YYYY-MM') AS month, b."currency"::text AS currency,
             c.id, c."kind"::text AS kind, c."nameZh", c."nameEn", SUM(t."amountIn" - t."amountOut") AS net
      FROM "CashTxn" t
      JOIN "BankAccount" b ON b.id = t."accountId"
      LEFT JOIN "CashCategory" c ON c.id = t."categoryId"
      GROUP BY 1, 2, 3, 4, 5, 6`,
    prisma.$queryRaw<{ month: string; currency: string; purpose: string; net: unknown }[]>`
      SELECT to_char(t."period", 'YYYY-MM') AS month, b."currency"::text AS currency, t."purpose", SUM(t."amountIn" - t."amountOut") AS net
      FROM "CashTxn" t
      JOIN "BankAccount" b ON b.id = t."accountId"
      JOIN "CashCategory" c ON c.id = t."categoryId"
      WHERE c."nameZh" = ${SALARY_CATEGORY}
      GROUP BY 1, 2, 3`,
  ]);
  const rates = fx.rates;
  const usd = (cur: string, n: unknown) => Number(n) * (rates[cur] ?? 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const all = [...byDate.map((r) => r.month), ...byPeriod.map((r) => r.month)].sort();
  const months: CashDashboard["months"] = [];
  if (all.length) {
    const d = monthStart(all[0]);
    const last = all[all.length - 1] > thisMonth ? all[all.length - 1] : thisMonth;
    while (d.toISOString().slice(0, 7) <= last) {
      months.push({ month: d.toISOString().slice(0, 7), closing: 0, income: 0, expense: 0 });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  const index = new Map(months.map((m, i) => [m.month, i]));

  const netByMonth = months.map(() => ({}) as Record<string, number>);
  for (const r of byDate) {
    const row = netByMonth[index.get(r.month)!];
    row[r.currency] = (row[r.currency] ?? 0) + Number(r.net);
  }
  const running: Record<string, number> = {};
  months.forEach((m, i) => {
    for (const [cur, n] of Object.entries(netByMonth[i])) running[cur] = (running[cur] ?? 0) + n;
    m.closing = toUsd(running, rates);
  });

  const spendFrom = months[Math.max(0, (index.get(thisMonth) ?? months.length) - 12)]?.month ?? thisMonth;
  const spending = new Map<string, CashDashboard["spending"][number]>();
  for (const r of byPeriod) {
    const m = months[index.get(r.month)!];
    const v = usd(r.currency, r.net);
    if (r.kind === "INCOME") m.income += v;
    if (r.kind === "EXPENSE") {
      m.expense -= v;
      if (r.id && r.month >= spendFrom && r.month < thisMonth) {
        const s = spending.get(r.id) ?? { id: r.id, name: r.nameZh ?? "", nameEn: r.nameEn ?? "", usd: 0, byPurpose: [] };
        s.usd -= v;
        spending.set(r.id, s);
      }
    }
  }

  const salaryRow = [...spending.values()].find((s) => s.name === SALARY_CATEGORY);
  if (salaryRow) {
    const byPurpose = new Map<string, number>();
    for (const r of salary) {
      if (r.month < spendFrom || r.month >= thisMonth) continue;
      byPurpose.set(r.purpose, (byPurpose.get(r.purpose) ?? 0) - usd(r.currency, r.net));
    }
    salaryRow.byPurpose = [...byPurpose.entries()].map(([purpose, v]) => ({ purpose, usd: v }));
  }

  return {
    ratesUpdatedAt: fx.updatedAt,
    months,
    currencies: Object.entries(running)
      .map(([currency, native]) => ({ currency, native, usd: native * (rates[currency] ?? 0) }))
      .filter((c) => Math.abs(c.native) >= 0.005)
      .sort((a, b) => b.usd - a.usd),
    spending: [...spending.values()].filter((s) => Math.abs(s.usd) >= 0.5).sort((a, b) => b.usd - a.usd),
  };
}

export type CashLedgerRow = {
  id: string;
  date: string;
  /** yyyy-mm (使用月). */
  period: string;
  accountId: string;
  account: string;
  currency: string;
  company: string;
  categoryId: string;
  category: string;
  kind: string;
  purpose: string;
  party: string;
  memo: string;
  amountIn: number;
  amountOut: number;
  /** Running balance of the account after this line. */
  balance: number;
  invoiceId: string;
  invoiceNumber: string;
};

export async function loadCashLedger() {
  const [txns, accounts, categories] = await Promise.all([
    prisma.cashTxn.findMany({
      orderBy: [{ accountId: "asc" }, { date: "asc" }, { seq: "asc" }, { createdAt: "asc" }],
      include: {
        account: { select: { ...NAME_FIELDS, company: { select: { legalName: true } } } },
        category: { select: { nameZh: true, kind: true } },
        invoice: { select: { number: true } },
      },
    }),
    prisma.bankAccount.findMany({
      where: { use: { in: [...BALANCE_USES] } },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, ...NAME_FIELDS, active: true },
    }),
    prisma.cashCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }], select: { id: true, nameZh: true, nameEn: true, kind: true, active: true } }),
  ]);

  const running = new Map<string, number>();
  const rows: CashLedgerRow[] = txns.map((t) => {
    const amountIn = Number(t.amountIn);
    const amountOut = Number(t.amountOut);
    const balance = round2((running.get(t.accountId) ?? 0) + amountIn - amountOut);
    running.set(t.accountId, balance);
    return {
      id: t.id,
      date: t.date.toISOString(),
      period: t.period.toISOString().slice(0, 7),
      accountId: t.accountId,
      account: accountNameWithCurrency(t.account),
      currency: t.account.currency,
      company: t.account.company?.legalName ?? "",
      categoryId: t.categoryId ?? "",
      category: t.category?.nameZh ?? "",
      kind: t.category?.kind ?? "",
      purpose: t.purpose,
      party: t.party,
      memo: t.memo,
      amountIn,
      amountOut,
      balance,
      invoiceId: t.invoiceId ?? "",
      invoiceNumber: t.invoice?.number ?? "",
    };
  });
  // Newest first, keeping the account's own order within a day.
  rows.reverse().sort((a, b) => b.date.localeCompare(a.date));

  return {
    rows,
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, name: accountNameWithCurrency(a), currency: a.currency, active: a.active })),
    categories,
  };
}
