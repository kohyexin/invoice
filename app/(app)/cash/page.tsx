import { PageHeader } from "@/components/ui/page-header";
import { loadCashAccounts } from "@/lib/cash";
import { requirePage } from "@/lib/session";
import { CashPositionView } from "./cash-position-view";

export default async function CashPositionPage() {
  await requirePage("cashReports");
  const data = await loadCashAccounts();
  return (
    <>
      <PageHeader
        title="Cash position"
        subtitle="What is in every bank account now, in its own currency and in USD at the latest Yahoo Finance rate."
      />
      <CashPositionView {...data} />
    </>
  );
}
