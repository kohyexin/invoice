import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { mailboxConfigured } from "@/lib/system-import";
import { ImportsView } from "./imports-view";

export default async function ImportsPage() {
  const [pending, recent, clients] = await Promise.all([
    prisma.importReview.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, subject: true, filename: true, receivedAt: true, createdAt: true, parsed: true, reason: true },
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
        subtitle="Invoices from the STAR SAAS billing system, read from the invoice mailbox or uploaded here, and posted to the ledger as System."
      />
      <ImportsView
        mailbox={mailboxConfigured() ? { user: process.env.IMAP_USER ?? "", folder: process.env.IMAP_FOLDER || "INBOX" } : null}
        clients={clients}
        pending={pending.map((p) => ({
          id: p.id,
          subject: p.subject,
          filename: p.filename,
          receivedAt: (p.receivedAt ?? p.createdAt).toISOString(),
          reason: p.reason,
          parsed: (p.parsed ?? {}) as Record<string, string | number | null>,
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
