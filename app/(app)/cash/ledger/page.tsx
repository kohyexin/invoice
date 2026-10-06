import { PageHeader } from "@/components/ui/page-header";
import { loadCashLedger } from "@/lib/cash";
import { CashLedgerView } from "./cash-ledger-view";

export default async function CashLedgerPage({ searchParams }: { searchParams: { account?: string } }) {
  const data = await loadCashLedger();
  return (
    <>
      <PageHeader title="Cash book" subtitle="Every bank line across all accounts, in each account's own currency. Replaces the per-bank sheets." />
      <CashLedgerView key={searchParams.account ?? ""} {...data} initialAccount={searchParams.account ?? ""} />
    </>
  );
}
