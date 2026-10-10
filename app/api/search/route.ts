import { prisma } from "@/lib/db";
import { can } from "@/lib/roles";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";

const TAKE_INVOICES = 15;
const TAKE_CASH = 8;
const TAKE_AGREEMENTS = 8;

const EMPTY = { clients: [], invoices: [], invoiceTotal: 0, cash: [], cashTotal: 0, agreements: [] };

/** Clients, invoices, cash book lines and agreements for the ⌘K palette, limited to what the role can view. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const seeClients = can(user.role, "clients");
  const seeInvoices = can(user.role, "invoices");
  const seeCash = can(user.role, "cashBook");
  const seeAgreements = can(user.role, "agreements");

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || (!seeClients && !seeInvoices && !seeCash && !seeAgreements)) return Response.json(EMPTY);

  const contains = { contains: q, mode: "insensitive" as const };
  // "1,600" and "1600" should both find an amount of 1600.00.
  const digits = q.replace(/,/g, "");
  const isAmount = /^\d+(\.\d*)?$/.test(digits);
  const like = `%${digits}%`;
  const [amountIds, cashAmountIds] = await Promise.all([
    seeInvoices && isAmount
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Invoice"
          WHERE "amount"::text LIKE ${like} OR "usdAmount"::text LIKE ${like} OR "receivedAmount"::text LIKE ${like}`.then((r) => r.map((x) => x.id))
      : [],
    seeCash && isAmount
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "CashTxn" WHERE "amountIn"::text LIKE ${like} OR "amountOut"::text LIKE ${like}`.then((r) => r.map((x) => x.id))
      : [],
  ]);

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
  const cashWhere = {
    OR: [
      { purpose: contains },
      { party: contains },
      { memo: contains },
      { invoice: { number: contains } },
      ...(cashAmountIds.length ? [{ id: { in: cashAmountIds } }] : []),
    ],
  };

  const [clients, invoices, invoiceTotal, cash, cashTotal, agreements] = await Promise.all([
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
    seeCash
      ? prisma.cashTxn.findMany({
          where: cashWhere,
          orderBy: [{ date: "desc" }, { seq: "desc" }],
          take: TAKE_CASH,
          select: {
            id: true,
            date: true,
            purpose: true,
            party: true,
            memo: true,
            amountIn: true,
            amountOut: true,
            account: { select: { label: true, currency: true } },
            invoice: { select: { number: true } },
          },
        })
      : [],
    seeCash ? prisma.cashTxn.count({ where: cashWhere }) : 0,
    seeAgreements
      ? prisma.agreement.findMany({
          where: {
            OR: [{ agreementRef: contains }, { client: { name: contains } }, { template: { name: contains } }, { signers: { some: { OR: [{ name: contains }, { email: contains }] } } }],
          },
          orderBy: { createdAt: "desc" },
          take: TAKE_AGREEMENTS,
          select: { id: true, agreementRef: true, status: true, client: { select: { name: true } }, template: { select: { name: true } } },
        })
      : [],
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
    cash: cash.map((c) => ({
      id: c.id,
      date: c.date.toISOString().slice(0, 10),
      account: c.account.label,
      currency: c.account.currency,
      title: c.purpose || c.party || c.memo,
      invoiceNumber: c.invoice?.number ?? "",
      amount: Number(c.amountIn) || -Number(c.amountOut),
    })),
    cashTotal,
    agreements: agreements.map((a) => ({ id: a.id, ref: a.agreementRef, client: a.client.name, template: a.template.name, status: a.status })),
  });
}
