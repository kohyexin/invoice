import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { mailboxConfigured } from "@/lib/system-import";
import { ImportsView } from "./imports-view";

export const maxDuration = 60;

export default async function ImportsPage() {
  await requirePage("systemImports");
  const [pending, rejected, recent, clients] = await Promise.all([
    prisma.importReview.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        subject: true,
        filename: true,
        receivedAt: true,
        createdAt: true,
        parsed: true,
        reason: true,
        client: { select: { id: true, name: true } },
      },
    }),
    prisma.importReview.findMany({
      where: { status: "DISMISSED" },
      orderBy: [{ decidedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        subject: true,
        invoiceNumber: true,
        reason: true,
        decidedAt: true,
        createdAt: true,
        client: { select: { name: true } },
        decidedBy: { select: { name: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { generate: "SYSTEM", sourceMessageId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, number: true, invoiceDate: true, usdAmount: true, status: true, createdAt: true, client: { select: { name: true } }, alias: true },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, alias: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="System imports"
        subtitle="Invoices from the STAR SAAS billing system, read from the invoice mailbox or uploaded here. Nothing reaches the ledger until you approve it."
      />
      <ImportsView
        mailbox={
          mailboxConfigured()
            ? { user: process.env.IMAP_USER ?? "", folder: process.env.IMAP_FOLDER || "INBOX", prefix: process.env.IMAP_SUBJECT_PREFIX ?? "Invoice on" }
            : null
        }
        clients={clients}
        pending={pending.map((p) => ({
          id: p.id,
          subject: p.subject,
          filename: p.filename,
          receivedAt: (p.receivedAt ?? p.createdAt).toISOString(),
          reason: p.reason,
          parsed: (p.parsed ?? {}) as Record<string, string | number | null>,
          client: p.client,
        }))}
        rejected={rejected.map((r) => ({
          id: r.id,
          subject: r.subject,
          number: r.invoiceNumber,
          client: r.client?.name ?? null,
          reason: r.reason,
          rejectedAt: (r.decidedAt ?? r.createdAt).toISOString(),
          rejectedBy: r.decidedBy?.name ?? null,
        }))}
        recent={recent.map((r) => ({
          id: r.id,
          number: r.number,
          client: r.alias || r.client.name,
          invoiceDate: r.invoiceDate.toISOString(),
          usdAmount: Number(r.usdAmount),
          status: r.status,
          importedAt: r.createdAt.toISOString(),
        }))}
      />
    </>
  );
}
