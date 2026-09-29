import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { GenerateBadge, StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { fxRates } from "@/lib/rules";
import { formatDate, formatMoney, toDateInput } from "@/lib/utils";
import { loadLookups } from "../lookups";
import { InvoiceDetail } from "./invoice-detail";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const [inv, lookups, rates] = await Promise.all([
    prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        client: { select: { name: true } },
        lines: { orderBy: { sortOrder: "asc" } },
        document: { select: { id: true } },
        company: { select: { code: true } },
        bankAccount: { select: { label: true } },
        createdBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
      },
    }),
    loadLookups(),
    fxRates(),
  ]);
  if (!inv) notFound();

  const siblings = await prisma.invoice.findMany({
    where: { number: inv.number, NOT: { id: inv.id } },
    orderBy: { invoiceDate: "asc" },
    select: { id: true, invoiceDate: true, usdAmount: true, status: true, client: { select: { name: true } }, type: { select: { name: true } } },
  });

  const dec = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));

  return (
    <>
      <PageHeader
        breadcrumb="Invoices"
        breadcrumbHref="/invoices"
        title={inv.number}
        subtitle={`${inv.client.name} · ${formatDate(inv.invoiceDate)}`}
        actions={
          <div className="flex items-center gap-2">
            <GenerateBadge generate={inv.generate} />
            <StatusBadge status={inv.status} />
            {(inv.document || (inv.companyId && inv.lines.length > 0)) && (
              <a
                href={`/api/invoices/${inv.id}/pdf`}
                className="inline-flex h-9 items-center gap-2 rounded-control border border-overlay/10 bg-overlay/[0.04] px-3.5 text-sm font-medium text-ink hover:bg-overlay/[0.08]"
              >
                <FileDown className="h-4 w-4" />
                PDF
              </a>
            )}
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <InvoiceDetail
          id={inv.id}
          status={inv.status}
          lookups={{ ...lookups, rates }}
          initial={{
            clientId: inv.clientId,
            number: inv.number,
            alias: inv.alias,
            ownerId: inv.ownerId ?? "",
            typeId: inv.typeId ?? "",
            subtype: inv.subtype,
            generate: inv.generate,
            status: inv.status,
            invoiceDate: toDateInput(inv.invoiceDate),
            dueDate: toDateInput(inv.dueDate),
            currency: inv.currency,
            amount: dec(inv.amount),
            usdAmount: dec(inv.usdAmount),
            receivedDate: toDateInput(inv.receivedDate),
            receivedAmount: dec(inv.receivedAmount),
            receivedCurrency: inv.receivedCurrency ?? "",
            fee: dec(inv.fee),
            paymentNote: inv.paymentNote,
            notes: inv.notes,
          }}
        />

        <aside className="space-y-4">
          {(inv.company || inv.lines.length > 0) && (
            <div className="glass-panel neon-edge rounded-card p-5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Invoice</h2>
              <dl className="mt-3 space-y-1.5 text-[13px]">
                {inv.company && <Row label="Issuer" value={inv.company.code} />}
                <Row label="Language" value={inv.language === "ZH" ? "Chinese" : "English"} />
                {inv.bankAccount && <Row label="Pay to" value={inv.bankAccount.label} />}
                {inv.altCurrency && <Row label="Amount due" value={`${inv.altCurrency} ${formatMoney(Number(inv.altAmount))}`} />}
              </dl>
              {inv.lines.length > 0 && (
                <ul className="mt-4 divide-y divide-line/60 border-t border-line/60">
                  {inv.lines.map((l) => (
                    <li key={l.id} className="flex gap-3 py-2 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <p className="text-ink">{l.description}</p>
                        {l.detail && <p className="text-[12px] text-ink-soft">{l.detail}</p>}
                      </div>
                      <span className="tnum text-ink">{formatMoney(Number(l.amount))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="glass-panel neon-edge rounded-card p-5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">History</h2>
            <dl className="mt-3 space-y-1.5 text-[13px]">
              <Row label="Created" value={`${formatDateTime(inv.createdAt)} · ${inv.createdBy?.name ?? originLabel(inv)}`} />
              <Row label="Last changed" value={`${formatDateTime(inv.updatedAt)} · ${inv.updatedBy?.name ?? originLabel(inv)}`} />
            </dl>
          </div>

          {siblings.length > 0 && (
            <div className="glass-panel neon-edge rounded-card p-5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Same number</h2>
              <p className="mt-1 text-[12px] text-ink-soft">Other ledger rows carrying {inv.number}.</p>
              <ul className="mt-3 divide-y divide-line/60">
                {siblings.map((s) => (
                  <li key={s.id}>
                    <Link href={`/invoices/${s.id}`} className="flex items-center gap-3 py-2 text-[13px] hover:bg-overlay/[0.03]">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ink">{s.client.name}</p>
                        <p className="text-[12px] text-ink-soft">
                          {formatDate(s.invoiceDate)} · {s.type?.name ?? "—"}
                        </p>
                      </div>
                      <span className="tnum">{formatMoney(Number(s.usdAmount))}</span>
                      <StatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/** Who to credit when no user is recorded: rows from before user accounts. */
function originLabel(inv: { legacyNo: number | null; sourceMessageId: string | null }) {
  if (inv.legacyNo !== null) return "Excel import";
  if (inv.sourceMessageId) return "Mailbox import";
  return "Unknown";
}

function formatDateTime(d: Date) {
  return d
    .toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" })
    .replace(",", "");
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
