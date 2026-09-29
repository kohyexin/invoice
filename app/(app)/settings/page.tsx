import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/session";
import { SettingsView } from "./settings-view";

export default async function SettingsPage() {
  const me = await requirePageRole("ADMIN");
  const [companies, bankAccounts, rules, fx, owners, types, items, users] = await Promise.all([
    prisma.company.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.bankAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.paymentRule.findMany({ include: { company: true, bankAccount: true } }),
    prisma.fxRate.findMany({ orderBy: { currency: "asc" } }),
    prisma.owner.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.invoiceType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.invoiceItem.findMany({ orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }] }),
    prisma.user.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, totpEnabledAt: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Users, issuers, bank accounts, payment defaults, exchange rates and the lists used on invoices."
      />
      <SettingsView
        companies={companies}
        bankAccounts={bankAccounts}
        rules={rules.map((r) => ({
          id: r.id,
          companyId: r.companyId ?? "",
          currency: r.currency ?? "",
          bankAccountId: r.bankAccountId,
          companyName: r.company?.legalName ?? null,
          accountLabel: r.bankAccount.label,
        }))}
        fx={fx.map((r) => ({
          id: r.currency,
          currency: r.currency,
          perUsd: Math.round((1 / Number(r.usdPerUnit)) * 10000) / 10000,
          updatedAt: r.updatedAt.toISOString(),
        }))}
        owners={owners}
        types={types}
        items={items}
        users={users.map((u) => ({
          ...u,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          totpEnabledAt: u.totpEnabledAt?.toISOString() ?? null,
        }))}
        meId={me.id}
      />
    </>
  );
}
