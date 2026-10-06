import { PageHeader } from "@/components/ui/page-header";
import { loadCashAccounts } from "@/lib/cash";
import { CashPositionView } from "./cash-position-view";

export default async function CashPositionPage() {
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
