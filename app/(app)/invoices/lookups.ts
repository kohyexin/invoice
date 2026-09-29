import "server-only";
import { prisma } from "@/lib/db";
import { freshFxRates } from "@/lib/fx";

export async function loadLookups() {
  const [clients, owners, types, fx] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.owner.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.invoiceType.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, subtypeHint: true },
    }),
    freshFxRates(),
  ]);
  return { clients, owners, types, rates: fx.rates, ratesUpdatedAt: fx.updatedAt };
}
