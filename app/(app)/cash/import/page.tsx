import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { round2 } from "@/lib/utils";
import { accountNameWithCurrency } from "@/lib/account-name";
import type { SplitRow } from "@/lib/statements/types";
import { StatementImportView } from "./import-view";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const net = (r: { _sum: { amountIn: unknown; amountOut: unknown } }) => Number(r._sum.amountIn ?? 0) - Number(r._sum.amountOut ?? 0);

export default async function StatementImportPage() {
  await requirePage("statementImport");
  const lineSelect = {
    id: true,
    key: true,
    kind: true,
    date: true,
    period: true,
    amountIn: true,
    amountOut: true,
    categoryId: true,
    purpose: true,
    party: true,
    memo: true,
    description: true,
    counterparty: true,
    suggested: true,
    clientId: true,
    invoiceIds: true,
    splits: true,
    status: true,
    cashTxnId: true,
    decidedAt: true,
    createdAt: true,
    account: { select: { id: true, label: true, currency: true, bankName: true, accountType: true, accountNumber: true } },
    decidedBy: { select: { name: true } },
  } as const;

  const [categories, pending, rejected, recent, statements, clients, unpaid, credits] = await Promise.all([
    prisma.cashCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }],
      select: { id: true, nameZh: true, nameEn: true, kind: true },
    }),
    prisma.statementLine.findMany({ where: { status: "PENDING" }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: lineSelect }),
    prisma.statementLine.findMany({
      where: { status: "REJECTED" },
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 50,
      select: lineSelect,
    }),
    prisma.statementLine.findMany({
      where: { status: { in: ["IMPORTED", "IN_EXCEL"] } },
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 30,
      select: lineSelect,
    }),
    prisma.statementImport.findMany({
      orderBy: [{ periodStart: "desc" }, { id: "asc" }],
      take: 24,
      select: {
        id: true,
        file: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        closing: true,
        uploadedAt: true,
        account: { select: { id: true, label: true, currency: true, bankName: true, accountType: true, accountNumber: true, offStatement: true } },
      },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, alias: true } }),
    prisma.invoice.findMany({
      where: { status: "SENT" },
      orderBy: [{ invoiceDate: "asc" }, { number: "asc" }],
      select: { id: true, number: true, clientId: true, currency: true, invoiceDate: true, amount: true, amountPaid: true },
    }),
    prisma.clientCredit.groupBy({ by: ["clientId", "currency"], _sum: { amount: true } }),
  ]);

  // Rows of one invoice number (split by type) are ticked together.
  const invoices = new Map<string, { number: string; ids: string[]; clientId: string; currency: string; invoiceDate: string; due: number }>();
  for (const i of unpaid) {
    const k = `${i.number}|${i.currency}`;
    const due = Number(i.amount) - Number(i.amountPaid);
    const seen = invoices.get(k);
    if (seen) {
      seen.ids.push(i.id);
      seen.due = round2(seen.due + due);
    } else invoices.set(k, { number: i.number, ids: [i.id], clientId: i.clientId, currency: i.currency, invoiceDate: iso(i.invoiceDate), due: round2(due) });
  }
  const payment = {
    // Alias first: the cash book knows clients by it (e.g. "OCEANLINK · Weizhibao Bussiness Co., Limited").
    clients: clients.map((c) => ({ id: c.id, name: c.alias ? `${c.alias} · ${c.name}` : c.name })),
    invoices: [...invoices.values()].filter((i) => i.due > 0),
    credits: Object.fromEntries(credits.map((c) => [`${c.clientId}|${c.currency}`, round2(Number(c._sum.amount ?? 0))])),
  };

  const checks = await Promise.all(
    statements.map(async (s) => {
      const [book, waiting] = await Promise.all([
        prisma.cashTxn.aggregate({ where: { accountId: s.account.id, date: { lte: s.periodEnd } }, _sum: { amountIn: true, amountOut: true } }),
        prisma.statementLine.aggregate({ where: { accountId: s.account.id, status: "PENDING", date: { lte: s.periodEnd } }, _sum: { amountIn: true, amountOut: true } }),
      ]);
      const off = Number(s.account.offStatement);
      return {
        id: s.id,
        file: s.file,
        account: accountNameWithCurrency(s.account),
        accountId: s.account.id,
        currency: s.currency,
        periodStart: iso(s.periodStart),
        bankClosing: Number(s.closing),
        bookClosing: round2(net(book) - off),
        afterApproval: round2(net(book) + net(waiting) - off),
        offStatement: off,
        uploadedAt: s.uploadedAt.toISOString(),
      };
    }),
  );

  const toLine = (l: (typeof pending)[number]) => ({
    id: l.id,
    kind: l.kind as "opening" | "interest" | "entry",
    date: iso(l.date),
    period: iso(l.period ?? l.date).slice(0, 7),
    amountIn: Number(l.amountIn),
    amountOut: Number(l.amountOut),
    categoryId: l.categoryId ?? "",
    purpose: l.purpose,
    party: l.party,
    memo: l.memo,
    description: l.description,
    suggested: l.suggested,
    clientId: l.clientId ?? "",
    invoiceIds: (l.invoiceIds as string[] | null) ?? [],
    splits: (l.splits as SplitRow[] | null) ?? null,
    counterparty: l.counterparty,
    status: l.status,
    accountId: l.account.id,
    account: accountNameWithCurrency(l.account),
    currency: l.account.currency,
    decidedAt: (l.decidedAt ?? l.createdAt).toISOString(),
    decidedBy: l.decidedBy?.name ?? null,
  });

  return (
    <>
      <PageHeader
        title="Import statement"
        subtitle="Upload bank statements: ANEXT PDFs, Industrial Bank (XMXY) Excel downloads or Airwallex CSV reports. Each month is checked against the cash book; interest and anything missing wait here for approval before they reach the cash book."
      />
      <StatementImportView
        payment={payment}
        categories={categories}
        pending={pending.map(toLine)}
        rejected={rejected.map(toLine)}
        recent={recent.map(toLine)}
        statements={checks}
      />
    </>
  );
}
