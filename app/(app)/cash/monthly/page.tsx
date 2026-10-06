import { PageHeader } from "@/components/ui/page-header";
import { cashMonths, loadMonthlyStatement } from "@/lib/cash";
import { MonthlyView } from "./monthly-view";

function monthsBefore(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function MonthlyStatementPage({ searchParams }: { searchParams: { month?: string; view?: string } }) {
  const months = await cashMonths();
  const today = new Date().toISOString().slice(0, 7);
  const requested = searchParams.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : null;
  const month = requested ?? months.find((m) => m <= today) ?? today;
  const [older2, older1, statement] = await Promise.all([
    loadMonthlyStatement(monthsBefore(month, 2)),
    loadMonthlyStatement(monthsBefore(month, 1)),
    loadMonthlyStatement(month),
  ]);
  return (
    <>
      <PageHeader
        title="Monthly statement"
        subtitle="Opening balance, income, expenses and closing balance for a month. USD totals use the latest Yahoo Finance rate."
      />
      <MonthlyView
        statement={statement}
        recent={[older2, older1, statement]}
        months={months.includes(month) ? months : [month, ...months]}
        initialView={searchParams.view === "3m" ? "3m" : "month"}
      />
    </>
  );
}
