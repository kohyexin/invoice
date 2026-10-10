"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, HandCoins, Hourglass, Plus, Receipt, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerateBadge, StatusBadge } from "@/components/ui/badge";
import { DataTable, type Column, type FilterDef } from "@/components/ui/data-table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useCan } from "@/components/shell/user-context";
import { useI18n } from "@/components/i18n/locale-provider";
import { SidePanel } from "@/components/ui/side-panel";
import { fieldClass } from "@/components/ui/form-controls";
import { addDays, cn, formatDate, formatMoney, toDateInput } from "@/lib/utils";
import { markPaid, type PaymentInput } from "./actions";
import { EntryForm, PaymentFields, blankEntry, type Lookups } from "./entry-form";
import { RecordPaymentPanel } from "./record-payment";

export type LedgerRow = {
  id: string;
  number: string;
  clientId: string;
  client: string;
  alias: string;
  owner: string;
  type: string;
  subtype: string;
  generate: string;
  status: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  amount: number;
  usdAmount: number;
  receivedDate: string | null;
  receivedAmount: number | null;
  receivedCurrency: string;
  fee: number | null;
  paymentNote: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function LedgerView({ rows, lookups, initialQuery = "" }: { rows: LedgerRow[]; lookups: Lookups; initialQuery?: string }) {
  const router = useRouter();
  const canEdit = useCan("invoices", "EDIT");
  const canPay = useCan("invoicePayments", "EDIT");
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<LedgerRow | null>(null);
  const [recording, setRecording] = useState(false);

  const q = query.trim().toLowerCase();
  const digits = q.replace(/,/g, "");
  const isAmount = /^\d+(\.\d*)?$/.test(digits);
  const visible = q
    ? rows.filter(
        (r) =>
          [r.number, r.client, r.alias, r.subtype, r.paymentNote].some((v) => v.toLowerCase().includes(q)) ||
          (isAmount && [r.amount, r.usdAmount, r.receivedAmount].some((n) => n !== null && n.toFixed(2).includes(digits)))
      )
    : rows;

  const stats = useMemo(() => {
    const today = toDateInput(new Date());
    const unpaid = rows.filter((r) => r.status === "SENT");
    const year = today.slice(0, 4);
    return {
      unpaidUsd: unpaid.reduce((s, r) => s + r.usdAmount, 0),
      unpaidCount: unpaid.length,
      overdue: unpaid.filter((r) => toDateInput(r.dueDate ?? addDays(new Date(r.invoiceDate), 7)) < today).length,
      billedYtd: rows.filter((r) => r.invoiceDate.startsWith(year) && r.status !== "WAIVED").reduce((s, r) => s + r.usdAmount, 0),
      paidYtd: rows.filter((r) => r.receivedDate?.startsWith(year)).reduce((s, r) => s + (r.receivedAmount ?? 0), 0),
      year,
    };
  }, [rows]);

  const distinct = (pick: (r: LedgerRow) => string) => Array.from(new Set(rows.map(pick).filter(Boolean))).sort();
  const years = distinct((r) => r.invoiceDate.slice(0, 4)).reverse();

  const columns: Column<LedgerRow>[] = [
    {
      key: "number",
      header: "Invoice no.",
      fixed: true,
      width: "170px",
      accessor: (r) => r.number,
      render: (r) => (
        <Link href={`/invoices/${r.id}`} className="font-mono text-[13px] text-brand-700 dark:text-brand-200 hover:text-brand-900 dark:hover:text-brand-100">
          {r.number}
        </Link>
      ),
    },
    { key: "invoiceDate", header: "Date", width: "110px", accessor: (r) => r.invoiceDate, render: (r) => formatDate(r.invoiceDate) },
    {
      key: "client",
      header: "Client",
      width: "300px",
      accessor: (r) => r.client,
      render: (r) => (
        <Link href={`/clients/${r.clientId}`} className="block truncate text-ink hover:text-brand-700 dark:hover:text-brand-200" title={r.client}>
          {r.alias || r.client}
        </Link>
      ),
    },
    { key: "clientName", header: "Client name", defaultHidden: true, accessor: (r) => r.client, render: (r) => <span className="truncate">{r.client}</span> },
    { key: "type", header: "Type", accessor: (r) => r.type, render: (r) => r.type || "—" },
    { key: "subtype", header: "Subtype", accessor: (r) => r.subtype, render: (r) => <span className="text-ink-muted">{r.subtype || "—"}</span> },
    { key: "owner", header: "Owner", defaultHidden: true, accessor: (r) => r.owner, render: (r) => r.owner || "—" },
    { key: "generate", header: "Generate", accessor: (r) => r.generate, render: (r) => <GenerateBadge generate={r.generate} /> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      accessor: (r) => r.amount,
      render: (r) => (
        <span className="tnum">
          {r.currency !== "USD" && <span className="mr-1 text-[11px] text-ink-soft">{r.currency}</span>}
          {formatMoney(r.amount)}
        </span>
      ),
    },
    { key: "usdAmount", header: "USD", align: "right", accessor: (r) => r.usdAmount, render: (r) => <span className="tnum">{formatMoney(r.usdAmount)}</span> },
    { key: "status", header: "Status", accessor: (r) => r.status, render: (r) => <StatusBadge status={r.status} /> },
    { key: "receivedDate", header: "Received", accessor: (r) => r.receivedDate ?? "", render: (r) => (r.receivedDate ? formatDate(r.receivedDate) : "—") },
    {
      key: "receivedAmount",
      header: "Received (USD)",
      align: "right",
      defaultHidden: true,
      accessor: (r) => r.receivedAmount ?? 0,
      render: (r) => (r.receivedAmount === null ? "—" : <span className="tnum">{formatMoney(r.receivedAmount)}</span>),
    },
    { key: "fee", header: "Fee", align: "right", defaultHidden: true, accessor: (r) => r.fee ?? 0, render: (r) => (r.fee ? <span className="tnum">{formatMoney(r.fee)}</span> : "—") },
    { key: "paymentNote", header: "Payment note", defaultHidden: true, accessor: (r) => r.paymentNote, render: (r) => <span className="text-ink-muted">{r.paymentNote || "—"}</span> },
  ];

  const filters: FilterDef<LedgerRow>[] = [
    { id: "status", label: "Status", options: ["SENT", "PAID", "END", "LOST", "WAIVED"], match: (r, v) => r.status === v },
    { id: "type", label: "Type", options: distinct((r) => r.type), match: (r, v) => r.type === v },
    { id: "year", label: "Year", options: years, match: (r, v) => r.invoiceDate.startsWith(v) },
    { id: "month", label: "Month", options: MONTHS, match: (r, v) => MONTHS[Number(r.invoiceDate.slice(5, 7)) - 1] === v },
    { id: "owner", label: "Owner", options: distinct((r) => r.owner), match: (r, v) => r.owner === v, advanced: true },
    { id: "generate", label: "Generate", options: ["SYSTEM", "MANUAL"], match: (r, v) => r.generate === v, advanced: true },
    { id: "currency", label: "Currency", options: distinct((r) => r.currency), match: (r, v) => r.currency === v, advanced: true },
  ];

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Hourglass} tone="warning" label="Unpaid (USD)" value={formatMoney(stats.unpaidUsd, 0)} footer={<Hint>{t("{0} invoices sent, not paid", stats.unpaidCount)}</Hint>} />
        <KpiCard icon={AlertTriangle} tone="danger" label="Overdue" value={String(stats.overdue)} footer={<Hint>{t("Unpaid past the due date (invoice date + 7 days when none is set)")}</Hint>} />
        <KpiCard icon={Receipt} label={t("Billed {0} (USD)", stats.year)} value={formatMoney(stats.billedYtd, 0)} footer={<Hint>{t("Excluding waived")}</Hint>} />
        <KpiCard icon={Wallet} tone="success" label={t("Received {0} (USD)", stats.year)} value={formatMoney(stats.paidYtd, 0)} footer={<Hint>{t("Net of fees")}</Hint>} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search number, client, alias, subtype, amount")}
            className={cn(fieldClass, "pl-9")}
          />
        </div>
        {(canEdit || canPay) && (
          <div className="ml-auto flex gap-2">
            {canPay && (
              <Button variant="secondary" onClick={() => setRecording(true)}>
                <HandCoins className="h-4 w-4" />
                {t("Record payment")}
              </Button>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                {t("Record invoice")}
              </Button>
            )}
          </div>
        )}
      </div>

      <DataTable
        tableId="ledger"
        columns={columns}
        rows={visible}
        filters={filters}
        rowKey={(r) => r.id}
        exportName="invoices"
        defaultPageSize={50}
        rowActions={(r) =>
          canPay && r.status === "SENT" ? (
            <Button size="sm" variant="secondary" onClick={() => setPaying(r)}>
              {t("Mark paid")}
            </Button>
          ) : null
        }
      />

      <SidePanel open={adding} onClose={() => setAdding(false)} title="Record invoice">
        <p className="mb-4 text-[13px] text-ink-muted">
          {t("Adds a ledger row without producing a PDF. Use New invoice to compose and download one.")}
        </p>
        {adding && (
          <EntryForm
            id={null}
            initial={blankEntry()}
            lookups={lookups}
            onCancel={() => setAdding(false)}
            onDone={() => {
              setAdding(false);
              router.refresh();
            }}
          />
        )}
      </SidePanel>

      <MarkPaidPanel row={paying} onClose={() => setPaying(null)} />
      <RecordPaymentPanel open={recording} onClose={() => setRecording(false)} clients={lookups.clients} />
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-ink-soft">{children}</p>;
}

function MarkPaidPanel({ row, onClose }: { row: LedgerRow | null; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<PaymentInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { t } = useI18n();
  const [forId, setForId] = useState<string | null>(null);

  if (row && forId !== row.id) {
    setForId(row.id);
    setError(null);
    setV({
      receivedDate: toDateInput(new Date()),
      receivedAmount: String(row.usdAmount),
      receivedCurrency: row.currency === "USD" ? "" : row.currency,
      fee: "",
      paymentNote: "",
    });
  }

  function save() {
    if (!row || !v) return;
    start(async () => {
      const res = await markPaid(row.id, v);
      if (!res.ok) return setError(res.error);
      setForId(null);
      onClose();
      router.refresh();
    });
  }

  return (
    <SidePanel
      open={Boolean(row)}
      onClose={() => {
        setForId(null);
        onClose();
      }}
      title="Mark paid"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={save} loading={pending}>
            {t("Mark paid")}
          </Button>
        </>
      }
    >
      {row && v && (
        <>
          <div className="mb-5 rounded-card border border-line/70 p-4">
            <p className="font-mono text-[13px] text-brand-700 dark:text-brand-200">{row.number}</p>
            <p className="mt-0.5 text-sm text-ink">{row.client}</p>
            <p className="tnum mt-2 text-lg font-semibold text-ink">
              {row.currency} {formatMoney(row.amount)}
              {row.currency !== "USD" && <span className="ml-2 text-sm font-normal text-ink-soft">≈ USD {formatMoney(row.usdAmount)}</span>}
            </p>
          </div>
          {error && <p className="mb-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
          <PaymentFields
            value={v}
            onChange={(key, value) => setV((prev) => (prev ? { ...prev, [key]: value } : prev))}
            defaultAmount={String(row.usdAmount)}
          />
        </>
      )}
    </SidePanel>
  );
}
