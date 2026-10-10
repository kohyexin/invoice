import { PageHeader } from "@/components/ui/page-header";
import { loadCashLedger } from "@/lib/cash";
import { requirePage } from "@/lib/session";
import { CashLedgerView } from "./cash-ledger-view";

export default async function CashLedgerPage({ searchParams }: { searchParams: { account?: string; q?: string } }) {
  await requirePage("cashBook");
  const data = await loadCashLedger();
  return (
    <>
      <PageHeader title="Cash book" subtitle="Every bank line across all accounts, in each account's own currency. Replaces the per-bank sheets." />
      <CashLedgerView
        key={`${searchParams.account ?? ""}|${searchParams.q ?? ""}`}
        {...data}
        initialAccount={searchParams.account ?? ""}
        initialQuery={searchParams.q ?? ""}
      />
    </>
  );
}
