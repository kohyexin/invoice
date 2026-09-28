import "server-only";
import { prisma } from "@/lib/db";

export async function loadLookups() {
  const [clients, owners, types] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.owner.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.invoiceType.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, subtypeHint: true },
    }),
  ]);
  return { clients, owners, types };
}
