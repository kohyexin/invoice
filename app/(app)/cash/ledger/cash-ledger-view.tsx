"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column, type FilterDef } from "@/components/ui/data-table";
import { SidePanel } from "@/components/ui/side-panel";
import { Field, Select, fieldClass } from "@/components/ui/form-controls";
import { useCan } from "@/components/shell/user-context";
import { useI18n } from "@/components/i18n/locale-provider";
import { cn, formatDate, formatMoney, toDateInput } from "@/lib/utils";
import type { CashLedgerRow } from "@/lib/cash";
import { deleteCashTxn, markLinkedInvoicePaid, saveCashTxn, type CashTxnInput, type UnpaidLink } from "../actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<string, string> = { INCOME: "Income", EXPENSE: "Expense", TRANSFER: "Transfer" };
const KIND_TONE: Record<string, "success" | "danger" | "neutral"> = { INCOME: "success", EXPENSE: "danger", TRANSFER: "neutral" };

type Account = { id: string; label: string; name: string; currency: string; active: boolean };
type Category = { id: string; nameZh: string; nameEn: string; kind: string; active: boolean };

export function CashLedgerView({
  rows,
  accounts,
  categories,
  initialAccount,
  initialQuery = "",
}: {
  rows: CashLedgerRow[];
  accounts: Account[];
  categories: Category[];
  initialAccount: string;
  initialQuery?: string;
}) {
  const { t } = useI18n();
  const canEdit = useCan("cashBook", "EDIT");
  const [query, setQuery] = useState(initialQuery);
  const [editing, setEditing] = useState<CashLedgerRow | "new" | null>(null);
  const [unpaid, setUnpaid] = useState<UnpaidLink | null>(null);

  const q = query.trim().toLowerCase();
  const digits = q.replace(/,/g, "");
  const isAmount = /^\d+(\.\d*)?$/.test(digits);
  const visible = q
    ? rows.filter(
        (r) =>
          [r.purpose, r.party, r.memo, r.invoiceNumber, r.category].some((v) => v.toLowerCase().includes(q)) ||
          (isAmount && [r.amountIn, r.amountOut].some((n) => n > 0 && n.toFixed(2).includes(digits)))
      )
    : rows;

  const distinct = (pick: (r: CashLedgerRow) => string) => Array.from(new Set(rows.map(pick).filter(Boolean))).sort();
  const years = distinct((r) => r.date.slice(0, 4)).reverse();
  const purposes = useMemo(() => Array.from(new Set(rows.map((r) => r.purpose).filter(Boolean))).sort(), [rows]);

  const columns: Column<CashLedgerRow>[] = [
    {
      key: "date",
      header: "Date",
      fixed: true,
      accessor: (r) => r.date,
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatDate(r.date)}
          {r.period !== r.date.slice(0, 7) && (
            <span className="ml-1.5 text-[11px] text-ink-soft" title={t("Counted in {0} on the monthly statement", r.period)}>
              → {r.period}
            </span>
          )}
        </span>
      ),
    },
    { key: "period", header: "Month used", defaultHidden: true, accessor: (r) => r.period },
    { key: "account", header: "Account", accessor: (r) => r.account, render: (r) => <span className="text-ink-muted">{r.account}</span> },
    {
      key: "category",
      header: "Category",
      accessor: (r) => r.category,
      render: (r) =>
        r.category ? (
          <Badge tone={KIND_TONE[r.kind] ?? "neutral"}>{r.category}</Badge>
        ) : (
          <Badge tone="warning">{t("Uncategorized")}</Badge>
        ),
    },
    { key: "purpose", header: "Purpose", width: "200px", accessor: (r) => r.purpose, render: (r) => <span className="block truncate" title={r.purpose}>{r.purpose || "—"}</span> },
    {
      key: "detail",
      header: "Detail",
      width: "320px",
      accessor: (r) => [r.party, r.memo].filter(Boolean).join(" · "),
      render: (r) => {
        const text = [r.party, r.memo].filter(Boolean).join(" · ");
        return (
          <span className="block truncate text-ink-muted" title={text}>
            {text || "—"}
          </span>
        );
      },
    },
    {
      key: "invoice",
      header: "Invoice",
      accessor: (r) => r.invoiceNumber,
      render: (r) =>
        r.invoiceId ? (
          <Link href={`/invoices/${r.invoiceId}?from=cash`} className="font-mono text-[13px] text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-brand-100">
            {r.invoiceNumber}
          </Link>
        ) : (
          <span className="text-ink-soft">—</span>
        ),
    },
    {
      key: "amountIn",
      header: "Money in",
      align: "right",
      accessor: (r) => r.amountIn,
      render: (r) => (r.amountIn ? <Amount value={r.amountIn} currency={r.currency} className="text-emerald-700 dark:text-emerald-300" /> : null),
    },
    {
      key: "amountOut",
      header: "Money out",
      align: "right",
      accessor: (r) => r.amountOut,
      render: (r) => (r.amountOut ? <Amount value={r.amountOut} currency={r.currency} /> : null),
    },
    { key: "balance", header: "Balance", align: "right", accessor: (r) => r.balance, render: (r) => <Amount value={r.balance} currency={r.currency} className="text-ink-muted" /> },
    { key: "company", header: "Company", defaultHidden: true, accessor: (r) => r.company, render: (r) => r.company || "—" },
    { key: "party", header: "Paid invoice / party", exportOnly: true, accessor: (r) => r.party },
    { key: "memo", header: "Reference", exportOnly: true, accessor: (r) => r.memo },
    { key: "currency", header: "Currency", exportOnly: true, accessor: (r) => r.currency },
  ];

  const filters: FilterDef<CashLedgerRow>[] = [
    { id: "account", label: "Account", options: accounts.map((a) => a.name), match: (r, v) => r.account === v },
    { id: "category", label: "Category", options: distinct((r) => r.category), match: (r, v) => r.category === v },
    { id: "year", label: "Year", options: years, match: (r, v) => r.date.startsWith(v) },
    { id: "month", label: "Month", options: MONTHS, match: (r, v) => MONTHS[Number(r.date.slice(5, 7)) - 1] === v },
    { id: "kind", label: "Kind", options: ["Income", "Expense", "Transfer"], match: (r, v) => KIND_LABEL[r.kind] === v, advanced: true },
    { id: "company", label: "Company", options: distinct((r) => r.company), match: (r, v) => r.company === v, advanced: true },
  ];

  // Links pass the account id or its nickname.
  const startAccount = initialAccount ? accounts.find((a) => a.id === initialAccount || a.label === initialAccount) : undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search purpose, detail, invoice, amount")}
            className={cn(fieldClass, "pl-9")}
          />
        </div>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Link
              href="/cash/import"
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-control border border-overlay/10 bg-overlay/[0.04] px-4 text-sm font-medium text-ink transition-all hover:bg-overlay/[0.08]"
            >
              <FileUp className="h-4 w-4" />
              {t("Import statement")}
            </Link>
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />
              {t("Add cash line")}
            </Button>
          </div>
        )}
      </div>

      <DataTable
        tableId="cash-ledger"
        columns={columns}
        rows={visible}
        filters={filters}
        initialFilters={startAccount ? { account: startAccount.name } : undefined}
        rowKey={(r) => r.id}
        exportName="cash-book"
        defaultPageSize={50}
        rowActions={
          canEdit
            ? (r) => (
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                  {t("Edit")}
                </Button>
              )
            : undefined
        }
      />

      <TxnPanel
        row={editing}
        accounts={accounts}
        categories={categories}
        purposes={purposes}
        defaultAccount={startAccount?.id ?? ""}
        onClose={() => setEditing(null)}
        onUnpaid={setUnpaid}
      />
      <MarkPaidPrompt link={unpaid} onClose={() => setUnpaid(null)} />
    </>
  );
}

/** After saving a receipt linked to an unpaid invoice: offers to mark it paid. */
function MarkPaidPrompt({ link, onClose }: { link: UnpaidLink | null; onClose: () => void }) {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!link) return null;
  const money = (currency: string, n: number) => `${currency} ${formatMoney(n)}`;

  function close() {
    setError(null);
    onClose();
  }
  function confirm() {
    start(async () => {
      const res = await markLinkedInvoicePaid(link!.cashTxnId);
      if (!res.ok) return setError(res.error);
      close();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/60 px-4 backdrop-blur-sm animate-fade-in">
      <div role="alertdialog" aria-modal="true" aria-labelledby="mark-paid-title" className="w-full max-w-md rounded-card border border-overlay/10 bg-elevated p-6 shadow-2xl">
        <h2 id="mark-paid-title" className="text-base font-semibold text-ink">
          {t("Mark {0} paid?", link.number)}
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">{t("This line is linked to {0} for {1}, which is still unpaid.", link.number, link.client)}</p>
        <dl className="mt-4 grid grid-cols-2 gap-y-1.5 text-[13px]">
          <dt className="text-ink-soft">{t("Still due")}</dt>
          <dd className="tnum text-right text-ink">{money(link.currency, link.due)}</dd>
          <dt className="text-ink-soft">{t("This receipt")}</dt>
          <dd className="tnum text-right text-ink">{money(link.receivedCurrency, link.received)}</dd>
        </dl>
        {link.leftOver > 0 && (
          <p className="mt-3 text-[12px] text-ink-muted">{t("{0} left over goes to the client's credit.", money(link.currency, link.leftOver))}</p>
        )}
        {link.fromCredit > 0 && (
          <p className="mt-3 text-[12px] text-ink-muted">{t("{0} of the client's credit makes up the difference.", money(link.currency, link.fromCredit))}</p>
        )}
        {link.short > 0 && (
          <p className="mt-3 rounded-control border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200">
            {t("The receipt is {0} short. The invoice will still be marked paid in full.", money(link.currency, link.short))}
          </p>
        )}
        {link.receivedCurrency !== link.currency && (
          <p className="mt-3 text-[12px] text-ink-muted">{t("The receipt is in a different currency, so the invoice is marked paid without changing the client's credit.")}</p>
        )}
        {error && <p className="mt-3 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>
            {t("Not now")}
          </Button>
          <Button size="sm" onClick={confirm} loading={pending} autoFocus>
            {t("Mark paid")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Amount({ value, currency, className }: { value: number; currency: string; className?: string }) {
  return (
    <span className={cn("tnum", className)}>
      {currency !== "USD" && <span className="mr-1 text-[11px] text-ink-soft">{currency}</span>}
      {formatMoney(value)}
    </span>
  );
}

function blank(accountId: string): CashTxnInput {
  return { date: toDateInput(new Date()), period: "", accountId, categoryId: "", purpose: "", party: "", memo: "", amountIn: "", amountOut: "", invoiceNumber: "" };
}

function fromRow(r: CashLedgerRow): CashTxnInput {
  return {
    date: r.date.slice(0, 10),
    period: r.period === r.date.slice(0, 7) ? "" : r.period,
    accountId: r.accountId,
    categoryId: r.categoryId,
    purpose: r.purpose,
    party: r.party,
    memo: r.memo,
    amountIn: r.amountIn ? String(r.amountIn) : "",
    amountOut: r.amountOut ? String(r.amountOut) : "",
    invoiceNumber: r.invoiceNumber,
  };
}

function TxnPanel({
  row,
  accounts,
  categories,
  purposes,
  defaultAccount,
  onClose,
  onUnpaid,
}: {
  row: CashLedgerRow | "new" | null;
  accounts: Account[];
  categories: Category[];
  purposes: string[];
  defaultAccount: string;
  onClose: () => void;
  onUnpaid: (link: UnpaidLink) => void;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [v, setV] = useState<CashTxnInput | null>(null);
  const [forKey, setForKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const key = row === null ? null : row === "new" ? "new" : row.id;
  if (key !== forKey) {
    setForKey(key);
    setError(null);
    setV(row === null ? null : row === "new" ? blank(defaultAccount) : fromRow(row));
  }

  const editingId = row && row !== "new" ? row.id : null;
  const set = (k: keyof CashTxnInput, value: string) => setV((prev) => (prev ? { ...prev, [k]: value } : prev));
  const currency = accounts.find((a) => a.id === v?.accountId)?.currency ?? "";

  function save() {
    if (!v) return;
    start(async () => {
      const res = await saveCashTxn(editingId, v);
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
      if (res.unpaid) onUnpaid(res.unpaid);
    });
  }

  function remove() {
    if (!editingId || !window.confirm(t("Delete this line?"))) return;
    start(async () => {
      const res = await deleteCashTxn(editingId);
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  const groups: [string, Category[]][] = [
    ["Income", categories.filter((c) => c.kind === "INCOME")],
    ["Expense", categories.filter((c) => c.kind === "EXPENSE")],
    ["Transfer", categories.filter((c) => c.kind === "TRANSFER")],
  ];

  return (
    <SidePanel
      open={row !== null}
      onClose={onClose}
      title={editingId ? "Edit cash line" : "Add cash line"}
      footer={
        <>
          {editingId && (
            <Button variant="ghost" size="sm" className="mr-auto text-rose-600 dark:text-rose-300" onClick={remove} disabled={pending}>
              {t("Delete")}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={save} loading={pending}>
            {t("Save")}
          </Button>
        </>
      }
    >
      {v && (
        <div className="space-y-4">
          {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date *">
              <input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Account *">
              <Select value={v.accountId} onChange={(e) => set("accountId", e.target.value)}>
                <option value="">{t("Pick an account")}</option>
                {accounts
                  .filter((a) => a.active || a.id === v.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.label})
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label="Month used" hint="Leave blank for the month of the date. Set it when paying for another month, e.g. salary for August paid in September.">
            <input type="month" value={v.period} onChange={(e) => set("period", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Category" hint="Income and expense count on the monthly statement; transfers move money between accounts.">
            <Select value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">{t("Uncategorized")}</option>
              {groups.map(([label, list]) =>
                list.length ? (
                  <optgroup key={label} label={t(label)}>
                    {list
                      .filter((c) => c.active || c.id === v.categoryId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameEn ? `${c.nameZh} · ${c.nameEn}` : c.nameZh}
                        </option>
                      ))}
                  </optgroup>
                ) : null
              )}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={currency ? t("Money in ({0})", currency) : "Money in"}>
              <input inputMode="decimal" value={v.amountIn} onChange={(e) => set("amountIn", e.target.value)} className={cn(fieldClass, "tnum")} placeholder="0.00" />
            </Field>
            <Field label={currency ? t("Money out ({0})", currency) : "Money out"}>
              <input inputMode="decimal" value={v.amountOut} onChange={(e) => set("amountOut", e.target.value)} className={cn(fieldClass, "tnum")} placeholder="0.00" />
            </Field>
          </div>
          <Field label="Purpose" hint="用途: the client on a receipt, or what the money was spent on (e.g. 服务器, 卡消费).">
            <input list="cash-purposes" value={v.purpose} onChange={(e) => set("purpose", e.target.value)} className={fieldClass} />
            <datalist id="cash-purposes">
              {purposes.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Paid invoice / party" hint="Who paid or was paid, as in the workbook's Paid Invoice column.">
            <input value={v.party} onChange={(e) => set("party", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Reference" hint="发票号码: the bank's description or your note.">
            <input value={v.memo} onChange={(e) => set("memo", e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Invoice number" hint="Links the line to an invoice in this app. Leave blank when there is none.">
            <input value={v.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} className={cn(fieldClass, "font-mono")} />
          </Field>
        </div>
      )}
    </SidePanel>
  );
}
