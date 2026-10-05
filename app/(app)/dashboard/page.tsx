import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { DashboardView, type DashboardData } from "./dashboard-view";

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export default async function DashboardPage() {
  const [rows, clientCount] = await Promise.all([
    prisma.invoice.findMany({
      select: {
        invoiceDate: true,
        receivedDate: true,
        status: true,
        usdAmount: true,
        receivedAmount: true,
        clientId: true,
        alias: true,
        client: { select: { name: true } },
        type: { select: { name: true } },
      },
    }),
    prisma.client.count(),
  ]);

  const now = new Date();
  const thisMonth = monthKey(now);
  const recentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  const bucket = () => ({ amount: 0, count: 0 });
  const totals = { all: bucket(), paid: bucket(), unpaid: bucket(), endLost: bucket(), waived: bucket() };
  const months = new Map<string, { billed: number; count: number; received: number }>();
  const unpaidByClient = new Map<string, { clientId: string; name: string; amount: number; count: number; oldest: string; byMonth: Record<string, number> }>();
  const activeByType = new Map<string, Set<string>>();
  const activeClients = new Set<string>();
  const billedByClientMonth = new Map<string, { clientId: string; name: string; byType: Record<string, Record<string, number>> }>();

  for (const r of rows) {
    const usd = Number(r.usdAmount);
    const add = (b: { amount: number; count: number }) => {
      b.amount += usd;
      b.count++;
    };
    add(totals.all);
    if (r.status === "PAID") add(totals.paid);
    else if (r.status === "SENT") add(totals.unpaid);
    else if (r.status === "END" || r.status === "LOST") add(totals.endLost);
    else add(totals.waived);

    const m = monthKey(r.invoiceDate);
    const cur = months.get(m) ?? { billed: 0, count: 0, received: 0 };
    cur.billed += usd;
    cur.count++;
    months.set(m, cur);
    if (r.receivedDate && r.receivedAmount !== null) {
      const rm = monthKey(r.receivedDate);
      const rc = months.get(rm) ?? { billed: 0, count: 0, received: 0 };
      rc.received += Number(r.receivedAmount);
      months.set(rm, rc);
    }

    const label = r.alias || r.client.name;
    if (r.status === "SENT") {
      const u = unpaidByClient.get(r.clientId) ?? { clientId: r.clientId, name: label, amount: 0, count: 0, oldest: r.invoiceDate.toISOString(), byMonth: {} };
      u.amount += usd;
      u.count++;
      u.byMonth[m] = (u.byMonth[m] ?? 0) + usd;
      if (r.invoiceDate.toISOString() < u.oldest) u.oldest = r.invoiceDate.toISOString();
      unpaidByClient.set(r.clientId, u);
    }

    if (r.invoiceDate >= recentStart && r.status !== "WAIVED") {
      activeClients.add(r.clientId);
      const type = r.type?.name ?? "Untyped";
      if (!activeByType.has(type)) activeByType.set(type, new Set());
      activeByType.get(type)!.add(r.clientId);

      const c = billedByClientMonth.get(r.clientId) ?? { clientId: r.clientId, name: label, byType: {} };
      const t = (c.byType[type] ??= {});
      t[m] = (t[m] ?? 0) + usd;
      billedByClientMonth.set(r.clientId, c);
    }
  }

  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  const completed = monthly.filter((m) => m.month < thisMonth && m.count > 0);
  const best = completed.reduce<(typeof monthly)[number] | null>((b, m) => (!b || m.billed > b.billed ? m : b), null);
  const sortedCounts = completed.map((m) => m.billed).sort((a, b) => a - b);
  const median = sortedCounts.length ? sortedCounts[Math.floor(sortedCounts.length / 2)] : 0;
  const current = months.get(thisMonth) ?? { billed: 0, count: 0, received: 0 };

  const recentMonths = [0, 1, 2].map((i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2 + i, 1))));

  const data: DashboardData = {
    totals,
    clientCount,
    activeClients: activeClients.size,
    thisMonth: { month: thisMonth, ...current },
    best: best ? { month: best.month, billed: best.billed, count: best.count } : null,
    medianMonth: median,
    monthly,
    unpaid: [...unpaidByClient.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    activeByType: [...activeByType.entries()].map(([type, set]) => ({ type, clients: set.size })).sort((a, b) => b.clients - a.clients),
    recentMonths,
    recentClients: [...billedByClientMonth.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live from the invoice ledger. All amounts are USD equivalents." />
      <DashboardView data={data} />
    </>
  );
}
