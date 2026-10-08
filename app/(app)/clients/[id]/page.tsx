import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { creditBalances } from "@/lib/credit";
import { prisma } from "@/lib/db";
import { can } from "@/lib/roles";
import { requirePage } from "@/lib/session";
import { toDateInput } from "@/lib/utils";
import { ClientForm } from "./client-form";

export default async function ClientPage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const me = await requirePage("clients", isNew ? "EDIT" : "VIEW");
  const showInvoices = can(me.role, "invoices");
  const [client, owners] = await Promise.all([
    isNew
      ? null
      : prisma.client.findUnique({
          where: { id: params.id },
          include: {
            invoices: {
              orderBy: { invoiceDate: "desc" },
              select: {
                id: true,
                number: true,
                invoiceDate: true,
                status: true,
                generate: true,
                currency: true,
                amount: true,
                usdAmount: true,
                type: { select: { name: true } },
                subtype: true,
              },
            },
          },
        }),
    prisma.owner.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  if (!isNew && !client) notFound();
  const [balances, history] =
    client && showInvoices
      ? await Promise.all([
          creditBalances(prisma, client.id),
          prisma.clientCredit.findMany({
            where: { clientId: client.id },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 20,
            select: { id: true, date: true, currency: true, amount: true, note: true, invoice: { select: { id: true, number: true } } },
          }),
        ])
      : [[], []];

  const unpaid = !showInvoices ? 0 : client?.invoices.filter((i) => i.status === "SENT").reduce((s, i) => s + Number(i.usdAmount), 0) ?? 0;

  return (
    <>
      <PageHeader
        breadcrumb="Clients"
        breadcrumbHref="/clients"
        title={client?.name ?? "New client"}
        subtitle={client ? [client.alias, client.agreementNo, ...client.otherAgreements].filter(Boolean).join(" · ") || undefined : "Add a client by hand. Most clients come in through the Jotform import."}
      />
      <ClientForm
        id={client?.id ?? null}
        owners={owners.map((o) => ({ value: o.id, label: o.name }))}
        unpaid={unpaid}
        credit={{
          balances,
          history: history.map((h) => ({
            id: h.id,
            date: h.date.toISOString().slice(0, 10),
            currency: h.currency,
            amount: Number(h.amount),
            note: h.note,
            invoice: h.invoice,
          })),
        }}
        initial={{
          name: client?.name ?? "",
          alias: client?.alias ?? "",
          agreementNo: client?.agreementNo ?? "",
          otherAgreements: client?.otherAgreements.join(", ") ?? "",
          agreementDate: toDateInput(client?.agreementDate),
          country: client?.country ?? "",
          incorporationNo: client?.incorporationNo ?? "",
          address1: client?.address1 ?? "",
          address2: client?.address2 ?? "",
          address3: client?.address3 ?? "",
          city: client?.city ?? "",
          directorName: client?.directorName ?? "",
          contactTitle: client?.contactTitle ?? "",
          contactEmail: client?.contactEmail ?? "",
          websiteUrls: client?.websiteUrls ?? "",
          transferName: client?.transferName ?? "",
          defaultOwnerId: client?.defaultOwnerId ?? "",
          notes: client?.notes ?? "",
          fees: (client?.fees as Record<string, string>) ?? {},
        }}
        invoices={(showInvoices ? client?.invoices ?? [] : []).map((i) => ({
          id: i.id,
          number: i.number,
          invoiceDate: i.invoiceDate.toISOString(),
          status: i.status,
          generate: i.generate,
          currency: i.currency,
          amount: Number(i.amount),
          usdAmount: Number(i.usdAmount),
          type: i.type?.name ?? "",
          subtype: i.subtype,
        }))}
      />
    </>
  );
}
