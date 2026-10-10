import { PageHeader } from "@/components/ui/page-header";
import { cashMonths, loadMonthlyStatement } from "@/lib/cash";
import { requirePage } from "@/lib/session";
import { MonthlyView } from "./monthly-view";

function monthsBefore(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function MonthlyStatementPage({ searchParams }: { searchParams: { month?: string; view?: string } }) {
  await requirePage("cashReports");
  const months = await cashMonths();
  const today = new Date().toISOString().slice(0, 7);
  const requested = searchParams.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : null;
  const month = requested ?? months.find((m) => m <= today) ?? today;
  // A month is complete once the next month starts: its salary is paid on the 10th of the next month.
  const lastComplete = monthsBefore(today, 1);
  const end = month < lastComplete ? month : lastComplete;
  const span = [monthsBefore(end, 2), monthsBefore(end, 1), end];
  const loaded = await Promise.all([...new Set([...span, month])].map(loadMonthlyStatement));
  const byMonth = new Map(loaded.map((s) => [s.month, s]));
  const statement = byMonth.get(month)!;
  const recent = span.map((m) => byMonth.get(m)!);
  return (
    <>
      <PageHeader
        title="Monthly statement"
        subtitle="Opening balance, income, expenses and closing balance for a month. USD totals use the latest Yahoo Finance rate."
      />
      <MonthlyView
        statement={statement}
        recent={recent}
        months={months.includes(month) ? months : [month, ...months]}
        initialView={searchParams.view === "3m" ? "3m" : "month"}
      />
    </>
  );
}
