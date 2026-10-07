import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePage } from "@/lib/session";
import { LedgerView } from "./ledger-view";
import { loadLookups } from "./lookups";

export default async function InvoicesPage({ searchParams }: { searchParams: { q?: string } }) {
  await requirePage("invoices");
  const [invoices, lookups] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
      select: {
        id: true,
        number: true,
        alias: true,
        subtype: true,
        generate: true,
        status: true,
        invoiceDate: true,
        dueDate: true,
        currency: true,
        amount: true,
        usdAmount: true,
        receivedDate: true,
        receivedAmount: true,
        receivedCurrency: true,
        fee: true,
        paymentNote: true,
        client: { select: { id: true, name: true } },
        owner: { select: { name: true } },
        type: { select: { name: true } },
      },
    }),
    loadLookups(),
  ]);

  return (
    <>
      <PageHeader title="Invoices" subtitle="Every invoice billed, with its USD value and payment. Replaces the Invoice List sheet." />
      <LedgerView
        lookups={lookups}
        key={searchParams.q ?? ""}
        initialQuery={searchParams.q ?? ""}
        rows={invoices.map((i) => ({
          id: i.id,
          number: i.number,
          clientId: i.client.id,
          client: i.client.name,
          alias: i.alias,
          owner: i.owner?.name ?? "",
          type: i.type?.name ?? "",
          subtype: i.subtype,
          generate: i.generate,
          status: i.status,
          invoiceDate: i.invoiceDate.toISOString(),
          dueDate: i.dueDate?.toISOString() ?? null,
          currency: i.currency,
          amount: Number(i.amount),
          usdAmount: Number(i.usdAmount),
          receivedDate: i.receivedDate?.toISOString() ?? null,
          receivedAmount: i.receivedAmount === null ? null : Number(i.receivedAmount),
          receivedCurrency: i.receivedCurrency ?? "",
          fee: i.fee === null ? null : Number(i.fee),
          paymentNote: i.paymentNote,
        }))}
      />
    </>
  );
}
