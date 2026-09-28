"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerateBadge, StatusBadge } from "@/components/ui/badge";
import { Field, Select, fieldClass } from "@/components/ui/form-controls";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { deleteClient, saveClient, type ClientInput } from "../actions";

type InvoiceRow = {
  id: string;
  number: string;
  invoiceDate: string;
  status: string;
  generate: string;
  currency: string;
  amount: number;
  usdAmount: number;
  type: string;
  subtype: string;
};

const TEXT_FIELDS: { key: keyof ClientInput; label: string; mono?: boolean; wide?: boolean; hint?: string }[] = [
  { key: "name", label: "Client name *", wide: true },
  { key: "alias", label: "Alias", mono: true, hint: "Short name used on the ledger and system invoices, e.g. CIRCLEPAYMENT" },
  { key: "agreementNo", label: "Agreement no.", mono: true, hint: "Invoice numbers follow it: SPP-22062024 gives 22062024-001" },
  { key: "directorName", label: "Director / attention" },
  { key: "contactEmail", label: "Contact email" },
  { key: "address1", label: "Address line 1", wide: true },
  { key: "address2", label: "Address line 2", wide: true },
  { key: "address3", label: "Address line 3", wide: true },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "incorporationNo", label: "Incorporation no.", mono: true },
  { key: "contactTitle", label: "Contact title" },
  { key: "websiteUrls", label: "Website URLs", wide: true },
  { key: "transferName", label: "Transfer name", hint: "Payer name when funds arrive under a different name" },
];

export function ClientForm({
  id,
  initial,
  owners,
  invoices,
  unpaid,
}: {
  id: string | null;
  initial: ClientInput;
  owners: { value: string; label: string }[];
  invoices: InvoiceRow[];
  unpaid: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ClientInput>(initial);
  const [fees, setFees] = useState<[string, string][]>(Object.entries(initial.fees));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const set = (key: keyof ClientInput, v: string) => {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: v }));
  };

  function save() {
    setError(null);
    start(async () => {
      const res = await saveClient(id, { ...values, fees: Object.fromEntries(fees) });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      if (!id) router.push(`/clients/${res.id}`);
      else router.refresh();
    });
  }

  function remove() {
    if (!id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    start(async () => {
      const res = await deleteClient(id);
      if (!res.ok) {
        setError(res.error);
        setConfirmDelete(false);
        return;
      }
      router.push("/clients");
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <section className="glass-panel neon-edge rounded-card p-5">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Profile</h2>
          {error && <p className="mt-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-200">{error}</p>}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <div key={f.key} className={cn(f.wide && "sm:col-span-2")}>
                <Field label={f.label} hint={f.hint}>
                  <input
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                    className={cn(fieldClass, f.mono && "font-mono")}
                  />
                </Field>
              </div>
            ))}
            <Field label="Agreement date">
              <input type="date" value={values.agreementDate} onChange={(e) => set("agreementDate", e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Default owner">
              <Select value={values.defaultOwnerId} onChange={(e) => set("defaultOwnerId", e.target.value)}>
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  value={values.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={3}
                  className={cn(fieldClass, "h-auto py-2")}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="glass-panel neon-edge rounded-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Fee schedule</h2>
            <Button variant="secondary" size="sm" onClick={() => setFees((f) => [...f, ["", ""]])}>
              <Plus className="h-3.5 w-3.5" />
              Add fee
            </Button>
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">
            From the Jotform agreement. When an invoice item is linked to one of these fields, its amount is suggested as the rate.
          </p>
          <div className="mt-4 space-y-2">
            {fees.map(([k, v], i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2">
                <input
                  value={k}
                  onChange={(e) => setFees((f) => f.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))}
                  placeholder="FIELD"
                  className={cn(fieldClass, "font-mono text-[12px] uppercase")}
                />
                <input
                  value={v}
                  onChange={(e) => setFees((f) => f.map((p, j) => (j === i ? [p[0], e.target.value] : p)))}
                  className={fieldClass}
                />
                <button
                  onClick={() => setFees((f) => f.filter((_, j) => j !== i))}
                  aria-label="Remove fee"
                  className="flex h-10 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {fees.length === 0 && <p className="py-4 text-center text-[13px] text-ink-soft">No fees recorded.</p>}
          </div>
        </section>

        <div className="flex items-center gap-2.5">
          <Button onClick={save} loading={pending}>
            {id ? "Save changes" : "Create client"}
          </Button>
          {saved && <span className="text-[13px] text-emerald-300">Saved.</span>}
          {id && (
            <Button variant={confirmDelete ? "danger" : "ghost"} onClick={remove} disabled={pending} className="ml-auto">
              {confirmDelete ? "Confirm delete" : "Delete client"}
            </Button>
          )}
        </div>
      </div>

      {id && (
        <aside className="space-y-4">
          <div className="glass-panel neon-edge rounded-card p-5">
            <p className="text-sm font-medium text-ink-muted">Unpaid</p>
            <p className="tnum mt-1 text-2xl font-bold text-ink">USD {formatMoney(unpaid)}</p>
            <p className="mt-1 text-[13px] text-ink-soft">{invoices.length} invoices in total</p>
            <Link
              href={`/invoices/new?client=${id}`}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-control bg-gradient-to-r from-brand-600 to-brand-400 px-3.5 text-sm font-medium text-white shadow-glow-brand hover:brightness-110"
            >
              <FilePlus2 className="h-4 w-4" />
              New invoice
            </Link>
          </div>
          <div className="glass-panel neon-edge rounded-card p-5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">Invoices</h2>
            <ul className="mt-3 max-h-[60vh] divide-y divide-line/60 overflow-y-auto">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/invoices/${inv.id}`} className="flex items-center gap-3 py-2.5 hover:bg-overlay/[0.03]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px] text-brand-200">{inv.number}</p>
                      <p className="truncate text-[12px] text-ink-soft">
                        {formatDate(inv.invoiceDate)} · {inv.type || "—"}
                        {inv.subtype ? ` · ${inv.subtype}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tnum text-[13px] text-ink">{formatMoney(inv.usdAmount)}</p>
                      <div className="mt-0.5 flex justify-end gap-1">
                        <GenerateBadge generate={inv.generate} />
                        <StatusBadge status={inv.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {invoices.length === 0 && <li className="py-6 text-center text-[13px] text-ink-soft">No invoices yet.</li>}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
