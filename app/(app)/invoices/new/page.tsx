import { PageHeader } from "@/components/ui/page-header";
import { requirePageRole } from "@/lib/session";
import { Composer } from "./composer";
import { loadComposerProps } from "./load";

export default async function NewInvoicePage({ searchParams }: { searchParams: { client?: string } }) {
  await requirePageRole("STAFF");
  const props = await loadComposerProps();

  return (
    <>
      <PageHeader
        breadcrumb="Invoices"
        breadcrumbHref="/invoices"
        title="New invoice"
        subtitle="Compose a manual invoice, check the PDF, then save it to the ledger and download."
      />
      <Composer initialClientId={searchParams.client ?? ""} {...props} />
    </>
  );
}
