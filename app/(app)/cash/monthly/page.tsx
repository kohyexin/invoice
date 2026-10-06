import { PageHeader } from "@/components/ui/page-header";
import { cashMonths, loadMonthlyStatement } from "@/lib/cash";
import { MonthlyView } from "./monthly-view";

export default async function MonthlyStatementPage({ searchParams }: { searchParams: { month?: string } }) {
  const months = await cashMonths();
  const today = new Date().toISOString().slice(0, 7);
  const requested = searchParams.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : null;
  const month = requested ?? months.find((m) => m <= today) ?? today;
  const statement = await loadMonthlyStatement(month);
  return (
    <>
      <PageHeader
        title="Monthly statement"
        subtitle="Opening balance, income, expenses and closing balance for a month. USD totals use the latest Yahoo Finance rate."
      />
      <MonthlyView statement={statement} months={months.includes(month) ? months : [month, ...months]} />
    </>
  );
}
