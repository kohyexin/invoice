import "server-only";
import { prisma } from "@/lib/db";
import { freshFxRates } from "@/lib/fx";

/** Lists and defaults the composer needs, for both new and edit. */
export async function loadComposerProps() {
  const [companies, accounts, rules, clients, items, types, owners, usedAliases, fx] = await Promise.all([
    prisma.company.findMany({ where: { active: true, invoicing: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.bankAccount.findMany({ where: { active: true, use: { in: ["INVOICE", "BOTH"] } }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.paymentRule.findMany(),
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        alias: true,
        agreementNo: true,
        otherAgreements: true,
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

  // For clients with several agreements, the one their latest invoice used comes first.
  const multi = clients.filter((c) => c.otherAgreements.length);
  const recent = multi.length
    ? await prisma.invoice.findMany({
        where: { clientId: { in: multi.map((c) => c.id) } },
        orderBy: { invoiceDate: "desc" },
        select: { clientId: true, number: true, reference: true },
      })
    : [];
  const agreementsOf = (c: (typeof clients)[number]) => {
    const list = [...new Set([c.agreementNo, ...c.otherAgreements].map((a) => a.trim()).filter(Boolean))];
    if (list.length < 2) return list;
    const used = (a: string) => {
      const base = a.replace(/^[A-Za-z]+-/, "");
      return (i: { number: string; reference: string }) => i.reference.toUpperCase() === a.toUpperCase() || i.number.startsWith(`${base}-`);
    };
    const mine = recent.filter((i) => i.clientId === c.id);
    const latest = (a: string) => {
      const idx = mine.findIndex(used(a));
      return idx === -1 ? Infinity : idx;
    };
    return [...list].sort((a, b) => latest(a) - latest(b));
  };

  return {
    companies: companies.map((c) => ({ id: c.id, code: c.code, name: c.legalName, defaultLang: c.defaultLang })),
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, currency: a.currency, compact: a.compact })),
    rules: rules.map((r) => ({ companyId: r.companyId, currency: r.currency, bankAccountId: r.bankAccountId })),
    clients: clients.map((c) => ({ ...c, agreements: agreementsOf(c), fees: (c.fees ?? {}) as Record<string, unknown> })),
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
