import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { fxRates } from "@/lib/rules";
import { Composer } from "./composer";

export default async function NewInvoicePage({ searchParams }: { searchParams: { client?: string } }) {
  const [companies, accounts, rules, clients, items, types, owners, rates] = await Promise.all([
    prisma.company.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.bankAccount.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.paymentRule.findMany(),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        alias: true,
        agreementNo: true,
        directorName: true,
        address1: true,
        address2: true,
        address3: true,
        city: true,
        country: true,
        defaultOwnerId: true,
        fees: true,
      },
    }),
    prisma.invoiceItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }] }),
    prisma.invoiceType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.owner.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    fxRates(),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb="Invoices"
        breadcrumbHref="/invoices"
        title="New invoice"
        subtitle="Compose a manual invoice, check the PDF, then save it to the ledger and download."
      />
      <Composer
        initialClientId={searchParams.client ?? ""}
        companies={companies.map((c) => ({ id: c.id, code: c.code, name: c.legalName, defaultLang: c.defaultLang }))}
        accounts={accounts.map((a) => ({ id: a.id, label: a.label, currency: a.currency, compact: a.compact }))}
        rules={rules.map((r) => ({ companyId: r.companyId, currency: r.currency, bankAccountId: r.bankAccountId }))}
        clients={clients.map((c) => ({ ...c, fees: (c.fees ?? {}) as Record<string, unknown> }))}
        items={items.map((i) => ({ id: i.id, labelEn: i.labelEn, labelZh: i.labelZh, detailHint: i.detailHint ?? "", clientFee: i.clientFee ?? "" }))}
        types={types.map((t) => ({ id: t.id, name: t.name, subtypeHint: t.subtypeHint ?? "" }))}
        owners={owners.map((o) => ({ id: o.id, name: o.name }))}
        rates={rates}
      />
    </>
  );
}
