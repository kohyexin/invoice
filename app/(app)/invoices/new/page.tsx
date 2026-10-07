import { PageHeader } from "@/components/ui/page-header";
import { requirePage } from "@/lib/session";
import { Composer } from "./composer";
import { loadComposerProps } from "./load";

export default async function NewInvoicePage({ searchParams }: { searchParams: { client?: string } }) {
  await requirePage("invoiceCreate", "EDIT");
  const props = await loadComposerProps();

  return (
    <>
      <PageHeader
        breadcrumb="Invoices"
        breadcrumbHref="/invoices"
        title="New invoice"
        subtitle="Compose a manual invoice, check the PDF, then save it to the ledger, with or without downloading the PDF."
      />
      <Composer initialClientId={searchParams.client ?? ""} {...props} />
    </>
  );
}
