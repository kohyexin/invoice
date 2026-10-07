import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, PencilLine } from "lucide-react";
import { ActivityList } from "@/components/activity/activity-list";
import { PageHeader } from "@/components/ui/page-header";
import { GenerateBadge, StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/db";
import { getI18n } from "@/lib/i18n-server";
import type { Translate } from "@/lib/i18n";
import { can } from "@/lib/roles";
import { requirePage } from "@/lib/session";
import { formatDate, formatMoney, toDateInput } from "@/lib/utils";
import { loadLookups } from "../lookups";
import { InvoiceDetail } from "./invoice-detail";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const me = await requirePage("invoices");
  const [inv, lookups] = await Promise.all([
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
  ]);
  if (!inv) notFound();
  const { t } = getI18n();

  const [siblings, activity] = await Promise.all([
    prisma.invoice.findMany({
      where: { number: inv.number, NOT: { id: inv.id } },
      orderBy: { invoiceDate: "asc" },
      select: { id: true, invoiceDate: true, usdAmount: true, status: true, client: { select: { name: true } }, type: { select: { name: true } } },
    }),
    prisma.activityLog.findMany({ where: { entity: "invoice", entityId: inv.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const dec = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
  const composed = Boolean(inv.companyId && inv.lines.length > 0);

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
            {composed && can(me.role, "invoiceCreate", "EDIT") && (
              <Link
                href={`/invoices/${inv.id}/edit`}
                className="inline-flex h-9 items-center gap-2 rounded-control bg-brand px-3.5 text-sm font-medium text-white hover:bg-brand/90"
              >
                <PencilLine className="h-4 w-4" />
                {t("Edit invoice")}
              </Link>
            )}
            {(inv.document || composed) && (
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
          composed={composed}
          lookups={lookups}
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
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Invoice")}</h2>
              <dl className="mt-3 space-y-1.5 text-[13px]">
                {inv.company && <Row label={t("Issuer")} value={inv.company.code} />}
                <Row label={t("Language")} value={t(inv.language === "ZH" ? "Chinese" : "English")} />
                {inv.bankAccount && <Row label={t("Pay to")} value={inv.bankAccount.label} />}
                {inv.altCurrency && <Row label={t("Amount due")} value={`${inv.altCurrency} ${formatMoney(Number(inv.altAmount))}`} />}
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
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("History")}</h2>
            <dl className="mt-3 space-y-1.5 text-[13px]">
              <Row label={t("Created")} value={`${formatDateTime(inv.createdAt)} · ${inv.createdBy?.name ?? originLabel(inv, t)}`} />
              <Row label={t("Last changed")} value={`${formatDateTime(inv.updatedAt)} · ${inv.updatedBy?.name ?? originLabel(inv, t)}`} />
            </dl>
            {activity.length > 0 && (
              <div className="mt-4 border-t border-line/60 pt-4">
                <ActivityList
                  showEntity={false}
                  compact
                  rows={activity.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), changes: (a.changes as Record<string, unknown> | null) ?? null }))}
                />
              </div>
            )}
          </div>

          {siblings.length > 0 && (
            <div className="glass-panel neon-edge rounded-card p-5">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Same number")}</h2>
              <p className="mt-1 text-[12px] text-ink-soft">{t("Other ledger rows carrying {0}.", inv.number)}</p>
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
function originLabel(inv: { legacyNo: number | null; sourceMessageId: string | null }, t: Translate) {
  if (inv.legacyNo !== null) return t("Excel import");
  if (inv.sourceMessageId) return t("Mailbox import");
  return t("Unknown");
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
