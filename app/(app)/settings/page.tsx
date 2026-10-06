import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { requirePageRole } from "@/lib/session";
import { SettingsView } from "./settings-view";
import { DocumentStorage } from "./document-storage";
import { documentStats } from "@/lib/documents";
import { driveConfigured, getDriveConnection } from "@/lib/gdrive";

export default async function SettingsPage({ searchParams }: { searchParams: { drive?: string; reason?: string } }) {
  const me = await requirePageRole("ADMIN");
  const drive = searchParams.drive;
  const notice =
    drive === "connected" || drive === "error" || drive === "not-configured" ? { kind: drive as "connected" | "error" | "not-configured", reason: searchParams.reason } : null;
  const [connection, docStats] = await Promise.all([getDriveConnection(), documentStats()]);
  const [companies, bankAccounts, rules, fx, owners, types, items, users, cashCategories] = await Promise.all([
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
    prisma.cashCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }] }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.legalName]));

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Users, issuers, bank accounts, payment defaults, exchange rates, and the lists used on invoices and the cash book."
      />
      <DocumentStorage
        configured={driveConfigured()}
        connection={connection && { email: connection.email, connectedAt: connection.connectedAt, folderUrl: connection.folderUrl }}
        stats={docStats}
        notice={notice}
      />
      <SettingsView
        companies={companies}
        bankAccounts={bankAccounts.map((b) => ({ ...b, companyId: b.companyId ?? "", companyName: b.companyId ? companyName.get(b.companyId) ?? "" : "" }))}
        cashCategories={cashCategories}
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
          source: r.source,
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
