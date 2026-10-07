import "server-only";
import { prisma } from "@/lib/db";
import { can, type RoleInfo } from "@/lib/roles";
import { addDays, todayUtc } from "@/lib/utils";

export type ShellAlerts = {
  /** Mailbox imports waiting for review; null when the user can't act on them. */
  imports: { count: number; items: { id: string; subject: string; reason: string; at: string }[] } | null;
  /** Bank statement lines waiting for approval; null when the user can't act on them. */
  statementLines: { count: number } | null;
  overdue: { count: number; items: { id: string; number: string; client: string; dueDate: string; usd: number }[] };
};

const TAKE = 12;

/** What the header bell shows: open work, not a message history. */
export async function loadShellAlerts(role: RoleInfo): Promise<ShellAlerts> {
  const today = todayUtc();
  // Same rule as the ledger: no due date means invoice date + 7 days.
  const [sent, imports, statementLines] = await Promise.all([
    can(role, "invoices")
      ? prisma.invoice.findMany({
          where: {
            status: "SENT",
            OR: [{ dueDate: { lt: today } }, { dueDate: null, invoiceDate: { lt: addDays(today, -7) } }],
          },
          select: { id: true, number: true, invoiceDate: true, dueDate: true, usdAmount: true, client: { select: { name: true } } },
        })
      : [],
    can(role, "systemImports", "EDIT")
      ? Promise.all([
          prisma.importReview.count({ where: { status: "PENDING" } }),
          prisma.importReview.findMany({
            where: { status: "PENDING" },
            orderBy: { createdAt: "desc" },
            take: TAKE,
            select: { id: true, subject: true, reason: true, receivedAt: true, createdAt: true },
          }),
        ])
      : null,
    can(role, "statementImport", "EDIT") ? prisma.statementLine.count({ where: { status: "PENDING" } }) : null,
  ]);

  const overdue = sent
    .map((r) => ({ r, due: r.dueDate ?? addDays(r.invoiceDate, 7) }))
    .sort((a, b) => a.due.getTime() - b.due.getTime());

  return {
    imports: imports && {
      count: imports[0],
      items: imports[1].map((r) => ({
        id: r.id,
        subject: r.subject,
        reason: r.reason || "Ready to approve.",
        at: (r.receivedAt ?? r.createdAt).toISOString(),
      })),
    },
    statementLines: statementLines === null ? null : { count: statementLines },
    overdue: {
      count: overdue.length,
      items: overdue.slice(0, TAKE).map(({ r, due }) => ({
        id: r.id,
        number: r.number,
        client: r.client.name,
        dueDate: due.toISOString(),
        usd: Number(r.usdAmount),
      })),
    },
  };
}
