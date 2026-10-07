import { prisma } from "@/lib/db";
import { can } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const TAKE_INVOICES = 15;

/** Clients and invoices for the ⌘K palette, limited to what the role can view. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const seeClients = can(user.role, "clients");
  const seeInvoices = can(user.role, "invoices");

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || (!seeClients && !seeInvoices)) return Response.json({ clients: [], invoices: [], invoiceTotal: 0 });

  const contains = { contains: q, mode: "insensitive" as const };
  // "1,600" and "1600" should both find an amount of 1600.00.
  const digits = q.replace(/,/g, "");
  const amountIds = seeInvoices && /^\d+(\.\d*)?$/.test(digits)
    ? (
        await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Invoice"
          WHERE "amount"::text LIKE ${`%${digits}%`}
             OR "usdAmount"::text LIKE ${`%${digits}%`}
             OR "receivedAmount"::text LIKE ${`%${digits}%`}`
      ).map((r) => r.id)
    : [];

  const invoiceWhere = {
    OR: [
      { number: contains },
      { alias: contains },
      { reference: contains },
      { subtype: contains },
      { paymentNote: contains },
      { client: { name: contains } },
      ...(amountIds.length ? [{ id: { in: amountIds } }] : []),
    ],
  };

  const [clients, invoices, invoiceTotal] = await Promise.all([
    seeClients
      ? prisma.client.findMany({
          where: { OR: [{ name: contains }, { alias: contains }, { contactEmail: contains }, { agreementNo: contains }, { otherAgreements: { has: q.toUpperCase() } }] },
          orderBy: { name: "asc" },
          take: 8,
          select: { id: true, name: true, alias: true, country: true },
        })
      : [],
    seeInvoices
      ? prisma.invoice.findMany({
          where: invoiceWhere,
          orderBy: { invoiceDate: "desc" },
          take: TAKE_INVOICES,
          select: { id: true, number: true, currency: true, amount: true, status: true, client: { select: { name: true } } },
        })
      : [],
    seeInvoices ? prisma.invoice.count({ where: invoiceWhere }) : 0,
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
    invoiceTotal,
  });
}
