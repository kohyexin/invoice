import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/session";
import { billToFromClient, type BillTo } from "@/lib/bill-to";
import type { ComposerInput } from "@/lib/composer";
import { toDateInput } from "@/lib/utils";
import { Composer } from "../../new/composer";
import { loadComposerProps } from "../../new/load";

export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  await requirePageRole("STAFF");
  const [inv, props] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: { lines: { orderBy: { sortOrder: "asc" } }, client: true },
    }),
    loadComposerProps(),
  ]);
  if (!inv) notFound();
  if (!inv.companyId || inv.lines.length === 0) redirect(`/invoices/${inv.id}`);

  const dec = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
  const input: ComposerInput = {
    companyId: inv.companyId,
    language: inv.language,
    clientId: inv.clientId,
    billTo: (inv.billTo as BillTo | null) ?? billToFromClient(inv.client),
    number: inv.number,
    reference: inv.reference,
    invoiceDate: toDateInput(inv.invoiceDate),
    dueDate: toDateInput(inv.dueDate),
    currency: inv.currency,
    lines: inv.lines.map((l) => ({ itemId: l.itemId ?? "", description: l.description, detail: l.detail, rate: dec(l.rate), quantity: dec(l.quantity) })),
    taxAmount: Number(inv.taxAmount) ? dec(inv.taxAmount) : "",
    amountPaid: Number(inv.amountPaid) ? dec(inv.amountPaid) : "",
    altCurrency: inv.altCurrency ?? "",
    altAmount: dec(inv.altAmount),
    bankAccountId: inv.bankAccountId ?? "",
    extraAccountIds: inv.extraAccountIds,
    typeId: inv.typeId ?? "",
    subtype: inv.subtype,
    ownerId: inv.ownerId ?? "",
    alias: inv.alias,
    usdAmount: dec(inv.usdAmount),
  };

  return (
    <>
      <PageHeader
        breadcrumb={inv.number}
        breadcrumbHref={`/invoices/${inv.id}`}
        title="Edit invoice"
        subtitle="Change the lines or details, check the PDF, then save. The PDF is replaced and Drive keeps the old version."
      />
      <Composer initialClientId="" editing={{ id: inv.id, input, clientName: inv.client.name }} {...props} />
    </>
  );
}
