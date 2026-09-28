import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { ClientsView } from "./clients-view";

export default async function ClientsPage() {
  const [clients, stats] = await Promise.all([
    prisma.client.findMany({
      orderBy: { name: "asc" },
      include: { defaultOwner: { select: { name: true } } },
    }),
    prisma.invoice.groupBy({
      by: ["clientId", "status"],
      _count: { _all: true },
      _sum: { usdAmount: true },
    }),
  ]);

  const byClient = new Map<string, { invoices: number; unpaid: number; lastInvoice?: string }>();
  for (const s of stats) {
    const cur = byClient.get(s.clientId) ?? { invoices: 0, unpaid: 0 };
    cur.invoices += s._count._all;
    if (s.status === "SENT") cur.unpaid += Number(s._sum.usdAmount ?? 0);
    byClient.set(s.clientId, cur);
  }

  const rows = clients.map((c) => ({
    id: c.id,
    name: c.name,
    alias: c.alias,
    agreementNo: c.agreementNo,
    country: c.country,
    owner: c.defaultOwner?.name ?? "",
    invoices: byClient.get(c.id)?.invoices ?? 0,
    unpaid: byClient.get(c.id)?.unpaid ?? 0,
    submittedAt: c.submittedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader title="Clients" subtitle={`${rows.length} clients. Import a Jotform export to add new ones or refresh existing details.`} />
      <ClientsView rows={rows} />
    </>
  );
}
