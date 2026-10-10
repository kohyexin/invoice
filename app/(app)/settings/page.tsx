import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { can, effectivePermissions, isManager, isOwner } from "@/lib/roles";
import { requirePage } from "@/lib/session";
import { SettingsView } from "./settings-view";
import { DocumentStorage } from "./document-storage";
import { getSigningSettings } from "@/lib/agreements/signing-settings";
import { agreementDocumentStats } from "@/lib/agreement-documents";
import { documentStats } from "@/lib/documents";
import { agreementFolders, driveConfigured, getDriveConnection } from "@/lib/gdrive";

/** Connections made before agreements get their two agreement folders on first view. */
async function driveConnectionWithAgreementFolders() {
  const c = await getDriveConnection();
  if (!c || c.agreementsFolderUrl) return c;
  return agreementFolders()
    .then(getDriveConnection)
    .catch(() => c);
}

export default async function SettingsPage({ searchParams }: { searchParams: { drive?: string; reason?: string } }) {
  const me = await requirePage();
  const manager = isManager(me.role);
  const showSettings = can(me.role, "settings");
  if (!manager && !showSettings) redirect("/dashboard");
  const canEdit = can(me.role, "settings", "EDIT");

  const drive = searchParams.drive;
  const notice =
    drive === "connected" || drive === "error" || drive === "not-configured" ? { kind: drive as "connected" | "error" | "not-configured", reason: searchParams.reason } : null;
  const [connection, docStats, agreementStats, signingSettings] = showSettings
    ? await Promise.all([driveConnectionWithAgreementFolders(), documentStats(), agreementDocumentStats(), getSigningSettings()])
    : [null, null, null, null];
  const [companies, bankAccounts, rules, fx, owners, types, items, users, cashCategories, roles] = await Promise.all([
    prisma.company.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.bankAccount.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.paymentRule.findMany({ include: { company: true, bankAccount: true } }),
    prisma.fxRate.findMany({ orderBy: { currency: "asc" } }),
    prisma.owner.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.invoiceType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.invoiceItem.findMany({ orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }] }),
    manager
      ? prisma.user.findMany({
          orderBy: [{ active: "desc" }, { name: "asc" }],
          select: {
            id: true,
            email: true,
            name: true,
            roleId: true,
            role: { select: { name: true, system: true } },
            active: true,
            lastLoginAt: true,
            totpEnabledAt: true,
            passwordHash: true,
            inviteExpiresAt: true,
          },
        })
      : [],
    prisma.cashCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { nameZh: "asc" }] }),
    manager ? prisma.appRole.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { users: true } } } }) : [],
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.legalName]));

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          showSettings
            ? "Users, issuers, bank accounts, payment defaults, exchange rates, and the lists used on invoices and the cash book."
            : "Users and roles."
        }
      />
      {showSettings && docStats && agreementStats && (
        <DocumentStorage
          configured={driveConfigured()}
          connection={
            connection && {
              email: connection.email,
              connectedAt: connection.connectedAt,
              folderUrl: connection.folderUrl,
              agreementsFolderUrl: connection.agreementsFolderUrl,
              signedAgreementsFolderUrl: connection.signedAgreementsFolderUrl,
            }
          }
          stats={docStats}
          agreementStats={agreementStats}
          notice={notice}
          canEdit={canEdit}
        />
      )}
      <SettingsView
        signingSettings={signingSettings}        manager={manager}
        owner={isOwner(me.role)}
        showSettings={showSettings}
        canEdit={canEdit}
        roles={roles.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          system: r.system,
          permissions: effectivePermissions(r.system, r.permissions),
          users: r._count.users,
        }))}
        companies={companies}
        bankAccounts={bankAccounts.map((b) => ({ ...b, offStatement: Number(b.offStatement), companyId: b.companyId ?? "", companyName: b.companyId ? companyName.get(b.companyId) ?? "" : "" }))}
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
        users={users.map(({ passwordHash, role, ...u }) => ({
          ...u,
          roleName: role.name,
          roleSystem: role.system,
          pending: !passwordHash,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          totpEnabledAt: u.totpEnabledAt?.toISOString() ?? null,
          inviteExpiresAt: u.inviteExpiresAt?.toISOString() ?? null,
        }))}
        meId={me.id}
      />
    </>
  );
}
