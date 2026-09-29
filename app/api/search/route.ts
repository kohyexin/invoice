import { prisma } from "@/lib/db";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";

/** Clients and invoices for the ⌘K palette. */
export async function GET(req: Request) {
  const denied = await apiDenied("VIEWER");
  if (denied) return denied;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ clients: [], invoices: [] });

  const contains = { contains: q, mode: "insensitive" as const };
  const [clients, invoices] = await Promise.all([
    prisma.client.findMany({
      where: { OR: [{ name: contains }, { alias: contains }, { contactEmail: contains }, { agreementNo: contains }] },
      orderBy: { name: "asc" },
      take: 5,
      select: { id: true, name: true, alias: true, country: true },
    }),
    prisma.invoice.findMany({
      where: { OR: [{ number: contains }, { alias: contains }, { reference: contains }, { client: { name: contains } }] },
      orderBy: { invoiceDate: "desc" },
      take: 6,
      select: { id: true, number: true, currency: true, amount: true, status: true, client: { select: { name: true } } },
    }),
  ]);

  return Response.json({
    clients: clients.map((c) => ({ id: c.id, name: c.name, detail: [c.alias, c.country].filter(Boolean).join(" · ") })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      client: i.client.name,
      amount: Number(i.amount),
      currency: i.currency,
      status: i.status,
    })),
  });
}
