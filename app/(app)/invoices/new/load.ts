import "server-only";
import { prisma } from "@/lib/db";
import { freshFxRates } from "@/lib/fx";

/** Lists and defaults the composer needs, for both new and edit. */
export async function loadComposerProps() {
  const [companies, accounts, rules, clients, items, types, owners, usedAliases, fx] = await Promise.all([
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
    prisma.invoice.groupBy({ by: ["clientId", "alias"], where: { alias: { not: "" } }, _count: { _all: true } }),
    freshFxRates(),
  ]);

  const aliases: Record<string, string[]> = {};
  for (const row of [...usedAliases].sort((a, b) => b._count._all - a._count._all)) {
    (aliases[row.clientId] ??= []).push(row.alias);
  }

  return {
    companies: companies.map((c) => ({ id: c.id, code: c.code, name: c.legalName, defaultLang: c.defaultLang })),
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, currency: a.currency, compact: a.compact })),
    rules: rules.map((r) => ({ companyId: r.companyId, currency: r.currency, bankAccountId: r.bankAccountId })),
    clients: clients.map((c) => ({ ...c, fees: (c.fees ?? {}) as Record<string, unknown> })),
    items: items.map((i) => ({
      id: i.id,
      labelEn: i.labelEn,
      labelZh: i.labelZh,
      detailHint: i.detailHint ?? "",
      clientFee: i.clientFee ?? "",
      typeId: i.typeId ?? "",
      subtype: i.subtype,
    })),
    types: types.map((t) => ({ id: t.id, name: t.name, subtypeHint: t.subtypeHint ?? "" })),
    owners: owners.map((o) => ({ id: o.id, name: o.name })),
    defaultOwnerId: owners.find((o) => o.isDefault)?.id ?? "",
    aliases,
    rates: fx.rates,
    ratesUpdatedAt: fx.updatedAt,
  };
}
