"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Field, Select, fieldClass } from "@/components/ui/form-controls";
import { SidePanel } from "@/components/ui/side-panel";
import { cn, formatDate, formatMoney, round2, toDateInput } from "@/lib/utils";
import { paymentContext, recordPayment, type OpenInvoice } from "./payment-actions";

type Context = { invoices: OpenInvoice[]; credit: { currency: string; amount: number }[] };

const num = (s: string) => {
  const n = Number(s.replace(/,/g, "").trim() || 0);
  return Number.isFinite(n) ? n : 0;
};

/** One payment that can cover several invoices; what's left over becomes the client's credit. */
export function RecordPaymentPanel({
  open,
  onClose,
  clients,
  clientId: fixedClientId,
}: {
  open: boolean;
  onClose: () => void;
  clients: { id: string; name: string }[];
  clientId?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [clientText, setClientText] = useState("");
  const [clientId, setClientId] = useState(fixedClientId ?? "");
  const [ctx, setCtx] = useState<Context | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState(toDateInput(new Date()));
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (!open) return;
    setClientId(fixedClientId ?? "");
    setClientText("");
    setCtx(null);
    setAmount("");
    setFee("");
    setNote("");
    setDate(toDateInput(new Date()));
    setTicked(new Set());
    setTouched(false);
    setError(null);
  }, [open, fixedClientId]);

  useEffect(() => {
    if (!open || !clientId) return;
    startLoad(async () => {
      const c = await paymentContext(clientId);
      setCtx(c);
      setCurrency(c.invoices[0]?.currency ?? c.credit[0]?.currency ?? "USD");
      setTicked(new Set());
      setTouched(false);
    });
  }, [open, clientId]);

  const invoices = useMemo(() => ctx?.invoices.filter((i) => i.currency === currency) ?? [], [ctx, currency]);
  const credit = Math.max(ctx?.credit.find((c) => c.currency === currency)?.amount ?? 0, 0);
  const paying = num(amount);

  // Until invoices are ticked by hand, tick the oldest ones the payment and credit cover in full.
  useEffect(() => {
    if (touched) return;
    let left = round2(paying + credit);
    const next = new Set<string>();
    for (const i of invoices) {
      if (i.due > left + 0.005) break;
      next.add(i.id);
      left = round2(left - i.due);
    }
    setTicked(next);
  }, [paying, credit, invoices, touched]);

  const due = round2(invoices.filter((i) => ticked.has(i.id)).reduce((s, i) => s + i.due, 0));
  const fromCredit = round2(Math.max(due - paying, 0));
  const leftOver = round2(Math.max(paying - due, 0));
  const short = fromCredit > credit + 0.005;
  const currencies = [...new Set([...(ctx?.invoices.map((i) => i.currency) ?? []), ...(ctx?.credit.map((c) => c.currency) ?? []), "USD"])];

  function pickClient(text: string) {
    setClientText(text);
    setClientId(clients.find((c) => c.name === text)?.id ?? "");
  }

  function toggle(id: string) {
    setTouched(true);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const res = await recordPayment({ clientId, currency, date, amount, fee, note, invoiceIds: invoices.filter((i) => ticked.has(i.id)).map((i) => i.id) });
      if (!res.ok) return setError(res.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Record payment"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={!clientId || short || (!paying && !ticked.size)}>
            {t("Record payment")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-ink-muted">
        {t("For a payment that covers several invoices or more than what's due. Ticked invoices are marked paid; anything left over is kept as the client's credit and used on their next invoices.")}
      </p>
      {error && <p className="mb-4 rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!fixedClientId && (
          <div className="sm:col-span-2">
            <Field label="Client *">
              <input
                list="payment-clients"
                value={clientText}
                onChange={(e) => pickClient(e.target.value)}
                placeholder={t("Type to search")}
                className={cn(fieldClass, clientText && !clientId && "border-amber-400/60")}
              />
              <datalist id="payment-clients">
                {clients.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>
          </div>
        )}
        <Field label="Received date *">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Currency">
          <Select
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value);
              setTouched(false);
            }}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount received" hint="Before the bank fee">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(fieldClass, "tnum text-right")} />
        </Field>
        <Field label="Fee (USD)">
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={cn(fieldClass, "tnum text-right")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Payment note">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass} />
          </Field>
        </div>
      </div>

      {clientId && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Unpaid invoices")}</h3>
            {credit > 0 && <span className="text-[12px] text-ink-muted">{t("Credit available: {0}", `${currency} ${formatMoney(credit)}`)}</span>}
          </div>
          {loading && <p className="py-4 text-center text-[13px] text-ink-soft">{t("Loading…")}</p>}
          {!loading && (
            <ul className="mt-2 divide-y divide-line/60 rounded-card border border-line/70">
              {invoices.map((i) => (
                <li key={i.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-overlay/[0.03]">
                    <input type="checkbox" checked={ticked.has(i.id)} onChange={() => toggle(i.id)} />
                    <span className="flex-1 font-mono text-[13px] text-ink">{i.number}</span>
                    <span className="text-[12px] text-ink-soft">{formatDate(i.invoiceDate)}</span>
                    <span className="tnum w-28 text-right text-[13px] text-ink">{formatMoney(i.due)}</span>
                  </label>
                </li>
              ))}
              {invoices.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-ink-soft">{t("No unpaid invoices in {0}.", currency)}</li>}
            </ul>
          )}
          <dl className="mt-4 space-y-1 text-[13px]">
            <Row label={t("Ticked invoices")} value={`${currency} ${formatMoney(due)}`} />
            {fromCredit > 0 && <Row label={t("Paid from credit")} value={`${currency} ${formatMoney(fromCredit)}`} />}
            {leftOver > 0 && <Row label={t("Kept as credit")} value={`${currency} ${formatMoney(leftOver)}`} strong />}
          </dl>
          {short && (
            <p className="mt-3 rounded-control border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-200">
              {t("The payment and credit don't cover the ticked invoices. Untick some.")}
            </p>
          )}
        </div>
      )}
    </SidePanel>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn("tnum", strong ? "font-semibold text-ink" : "text-ink")}>{value}</dd>
    </div>
  );
}
