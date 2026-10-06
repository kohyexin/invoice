import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/session";
import { round2 } from "@/lib/utils";
import { accountNameWithCurrency } from "@/lib/account-name";
import { StatementImportView } from "./import-view";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const net = (r: { _sum: { amountIn: unknown; amountOut: unknown } }) => Number(r._sum.amountIn ?? 0) - Number(r._sum.amountOut ?? 0);

export default async function StatementImportPage() {
  await requirePageRole("STAFF");
  const lineSelect = {
    id: true,
    key: true,
    kind: true,
    date: true,
    amountIn: true,
    amountOut: true,
    categoryId: true,
    purpose: true,
    party: true,
    memo: true,
    description: true,
    suggested: true,
    status: true,
    cashTxnId: true,
    decidedAt: true,
    createdAt: true,
    account: { select: { id: true, label: true, currency: true, bankName: true, accountType: true, accountNumber: true } },
    decidedBy: { select: { name: true } },
  } as const;

  const [categories, pending, rejected, recent, statements] = await Promise.all([
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
      select: { id: true, file: true, currency: true, periodStart: true, periodEnd: true, closing: true, uploadedAt: true, account: { select: { id: true, label: true, currency: true, bankName: true, accountType: true, accountNumber: true } } },
    }),
  ]);

  const checks = await Promise.all(
    statements.map(async (s) => {
      const [book, waiting] = await Promise.all([
        prisma.cashTxn.aggregate({ where: { accountId: s.account.id, date: { lte: s.periodEnd } }, _sum: { amountIn: true, amountOut: true } }),
        prisma.statementLine.aggregate({ where: { accountId: s.account.id, status: "PENDING", date: { lte: s.periodEnd } }, _sum: { amountIn: true, amountOut: true } }),
      ]);
      return {
        id: s.id,
        file: s.file,
        account: accountNameWithCurrency(s.account),
        accountId: s.account.id,
        currency: s.currency,
        periodStart: iso(s.periodStart),
        bankClosing: Number(s.closing),
        bookClosing: round2(net(book)),
        afterApproval: round2(net(book) + net(waiting)),
        uploadedAt: s.uploadedAt.toISOString(),
      };
    }),
  );

  const toLine = (l: (typeof pending)[number]) => ({
    id: l.id,
    kind: l.kind as "opening" | "interest" | "entry",
    date: iso(l.date),
    amountIn: Number(l.amountIn),
    amountOut: Number(l.amountOut),
    categoryId: l.categoryId ?? "",
    purpose: l.purpose,
    party: l.party,
    memo: l.memo,
    description: l.description,
    suggested: l.suggested,
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
        subtitle="Upload monthly bank statement PDFs. Each month is checked against the cash book; interest and anything missing wait here for approval before they reach the cash book."
      />
      <StatementImportView
        categories={categories}
        pending={pending.map(toLine)}
        rejected={rejected.map(toLine)}
        recent={recent.map(toLine)}
        statements={checks}
      />
    </>
  );
}
