"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, fieldClass } from "@/components/ui/form-controls";
import { CURRENCIES, STATUSES, cn, round2, toDateInput } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { FxRateNote, type FxState } from "@/components/invoices/fx-rate-note";
import { deleteEntry, entryDefaults, saveEntry, type EntryInput } from "./actions";

export type Lookups = {
  clients: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  types: { id: string; name: string; subtypeHint: string | null }[];
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
};

export function blankEntry(): EntryInput {
  return {
    clientId: "",
    number: "",
    alias: "",
    ownerId: "",
    typeId: "",
    subtype: "",
    generate: "MANUAL",
    status: "SENT",
    invoiceDate: toDateInput(new Date()),
    dueDate: "",
    currency: "USD",
    amount: "",
    usdAmount: "",
    receivedDate: "",
    receivedAmount: "",
    receivedCurrency: "",
    fee: "",
    paymentNote: "",
    notes: "",
  };
}

/** Ledger row editor. `onDone` gets the saved id, or null after delete. */
export function EntryForm({
  id,
  initial,
  lookups,
  onDone,
  onCancel,
  readOnly = false,
  printedLocked = false,
}: {
  id: string | null;
  initial: EntryInput;
  lookups: Lookups;
  onDone: (id: string | null) => void;
  onCancel?: () => void;
  readOnly?: boolean;
  /** Invoice made in the app: fields printed on its PDF are changed through Edit invoice instead. */
  printedLocked?: boolean;
}) {
  const { t } = useI18n();
  const [v, setV] = useState<EntryInput>(initial);
  const [clientText, setClientText] = useState(() => lookups.clients.find((c) => c.id === initial.clientId)?.name ?? "");
  const [usdTouched, setUsdTouched] = useState(Boolean(id));
  const [fx, setFx] = useState<FxState>({ rates: lookups.rates, updatedAt: lookups.ratesUpdatedAt });
  const [error, setError] = useState<string | null>(null);
  const [reuse, setReuse] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const byName = useMemo(() => new Map(lookups.clients.map((c) => [c.name.toLowerCase(), c.id])), [lookups.clients]);
  const typeHint = lookups.types.find((ty) => ty.id === v.typeId)?.subtypeHint;

  function suggestedUsd(amount: string, currency: string, rates = fx.rates) {
    const n = Number(amount.replace(/,/g, ""));
    const rate = currency === "USD" ? 1 : rates[currency];
    return amount && Number.isFinite(n) && rate ? String(round2(n * rate)) : "";
  }

  function set<K extends keyof EntryInput>(key: K, value: EntryInput[K]) {
    setReuse(null);
    setV((prev) => {
      const next = { ...prev, [key]: value };
      if (next.currency === "USD") next.usdAmount = next.amount;
      else if ((key === "amount" || key === "currency") && !usdTouched) next.usdAmount = suggestedUsd(next.amount, next.currency);
      if (key === "status" && value === "PAID") {
        next.receivedDate ||= toDateInput(new Date());
        next.receivedAmount ||= next.currency === "USD" ? next.amount : next.usdAmount;
        if (!next.receivedCurrency && next.currency !== "USD") next.receivedCurrency = next.currency;
      }
      return next;
    });
  }

  function pickClient(text: string) {
    setClientText(text);
    const clientId = byName.get(text.trim().toLowerCase()) ?? "";
    set("clientId", clientId);
    if (!clientId || id) return;
    start(async () => {
      const d = await entryDefaults(clientId);
      setV((prev) => {
        const next = {
          ...prev,
          clientId,
          number: prev.number || d.number,
          alias: d.alias,
          ownerId: d.ownerId,
          typeId: prev.typeId || d.typeId,
          currency: d.currency,
        };
        if (!usdTouched) next.usdAmount = suggestedUsd(next.amount, next.currency);
        return next;
      });
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const res = await saveEntry(id, v, Boolean(reuse));
      if (!res.ok) return setError(res.error);
      if (res.reuse) return setReuse(res.reuse);
      onDone(res.id);
    });
  }

  function remove() {
    if (!id) return;
    if (!confirmDelete) return setConfirmDelete(true);
    start(async () => {
      await deleteEntry(id);
      onDone(null);
    });
  }

  const paid = v.status === "PAID";
  const nonUsd = v.currency !== "USD";

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-5">
      {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
      {reuse && <p className="rounded-control border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-200">{t(reuse)}</p>}
      {printedLocked && !readOnly && (
        <p className="rounded-control border border-brand-500/25 bg-brand-500/10 px-3 py-2 text-[13px] text-ink">
          {t("This invoice was made in the app. Client, number, dates, currency and amount are printed on its PDF, so change them with Edit invoice at the top. The PDF is then updated too.")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Client *">
            <input
              list="entry-clients"
              value={clientText}
              disabled={printedLocked}
              onChange={(e) => pickClient(e.target.value)}
              placeholder={t("Type to search")}
              className={cn(fieldClass, clientText && !v.clientId && "border-amber-400/60")}
            />
            <datalist id="entry-clients">
              {lookups.clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Invoice no. *">
          <input value={v.number} disabled={printedLocked} onChange={(e) => set("number", e.target.value)} className={cn(fieldClass, "font-mono")} />
        </Field>
        <Field label="Alias">
          <input value={v.alias} onChange={(e) => set("alias", e.target.value)} className={cn(fieldClass, "font-mono uppercase")} />
        </Field>
        <Field label="Type">
          <Select value={v.typeId} onChange={(e) => set("typeId", e.target.value)}>
            <option value="">—</option>
            {lookups.types.map((ty) => (
              <option key={ty.id} value={ty.id}>
                {ty.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subtype">
          <input value={v.subtype} onChange={(e) => set("subtype", e.target.value)} placeholder={typeHint || t("Explains the type")} className={fieldClass} />
        </Field>
        <Field label="Owner">
          <Select value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
            <option value="">—</option>
            {lookups.owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Generate">
          <Select value={v.generate} onChange={(e) => set("generate", e.target.value as EntryInput["generate"])}>
            <option value="MANUAL">{t("Manual")}</option>
            <option value="SYSTEM">{t("System")}</option>
          </Select>
        </Field>
        <Field label="Invoice date *">
          <input type="date" value={v.invoiceDate} disabled={printedLocked} onChange={(e) => set("invoiceDate", e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Due date">
          <input type="date" value={v.dueDate} disabled={printedLocked} onChange={(e) => set("dueDate", e.target.value)} className={fieldClass} />
        </Field>
        <Field label="Currency">
          <Select value={v.currency} disabled={printedLocked} onChange={(e) => set("currency", e.target.value as EntryInput["currency"])}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={`${t("Amount ({0})", v.currency)} *`}>
          <input inputMode="decimal" value={v.amount} disabled={printedLocked} onChange={(e) => set("amount", e.target.value)} className={cn(fieldClass, "tnum text-right")} />
        </Field>
        {nonUsd && (
          <div className="sm:col-span-2">
            <Field label="USD equivalent" hint={t("Suggested from the {0} rate. Overwrite it with the booked figure if it differs.", v.currency)}>
              <input
                inputMode="decimal"
                value={v.usdAmount}
                onChange={(e) => {
                  setUsdTouched(true);
                  set("usdAmount", e.target.value);
                }}
                className={cn(fieldClass, "tnum text-right")}
              />
            </Field>
            {!readOnly && (
              <FxRateNote
                className="mt-1.5"
                currencies={[v.currency]}
                fx={fx}
                onChange={(next) => {
                  setFx(next);
                  if (!usdTouched) setV((prev) => ({ ...prev, usdAmount: suggestedUsd(prev.amount, prev.currency, next.rates) }));
                }}
              />
            )}
          </div>
        )}
        <Field label="Status">
          <Select value={v.status} onChange={(e) => set("status", e.target.value as EntryInput["status"])}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {paid && (
        <div className="rounded-card border border-line/70 p-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Payment")}</p>
          <PaymentFields
            value={v}
            onChange={(key, value) => set(key, value)}
            defaultAmount={v.currency === "USD" ? v.amount : v.usdAmount}
          />
        </div>
      )}

      <Field label="Notes">
        <textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={cn(fieldClass, "h-auto py-2")} />
      </Field>

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button onClick={save} loading={pending}>
            {t(reuse ? "Save anyway" : id ? "Save changes" : "Add to ledger")}
          </Button>
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={pending}>
              {t("Cancel")}
            </Button>
          )}
          {id && (
            <Button variant={confirmDelete ? "danger" : "ghost"} onClick={remove} disabled={pending} className="ml-auto">
              {t(confirmDelete ? "Confirm delete" : "Delete")}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}

type PaymentKeys = "receivedDate" | "receivedAmount" | "receivedCurrency" | "fee" | "paymentNote";

export function PaymentFields({
  value,
  onChange,
  defaultAmount,
}: {
  value: Pick<EntryInput, PaymentKeys>;
  onChange: (key: PaymentKeys, value: string) => void;
  defaultAmount: string;
}) {
  const { t } = useI18n();
  function setFee(fee: string) {
    onChange("fee", fee);
    const gross = Number(defaultAmount.replace(/,/g, ""));
    const f = Number(fee.replace(/,/g, "")) || 0;
    if (Number.isFinite(gross) && defaultAmount) onChange("receivedAmount", String(round2(gross - f)));
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Received date *">
        <input type="date" value={value.receivedDate} onChange={(e) => onChange("receivedDate", e.target.value)} className={fieldClass} />
      </Field>
      <Field label="Fee (USD)">
        <input inputMode="decimal" value={value.fee} onChange={(e) => setFee(e.target.value)} className={cn(fieldClass, "tnum text-right")} />
      </Field>
      <Field label="Received (USD) *" hint="Net of fee">
        <input
          inputMode="decimal"
          value={value.receivedAmount}
          onChange={(e) => onChange("receivedAmount", e.target.value)}
          className={cn(fieldClass, "tnum text-right")}
        />
      </Field>
      <Field label="Paid in" hint="When it arrived in another currency">
        <Select value={value.receivedCurrency} onChange={(e) => onChange("receivedCurrency", e.target.value)}>
          <option value="">USD</option>
          {CURRENCIES.filter((c) => c !== "USD").map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Payment note">
          <input
            value={value.paymentNote}
            onChange={(e) => onChange("paymentNote", e.target.value)}
            placeholder={t("e.g. Paid CNY 4,200, still owes USD 200")}
            className={fieldClass}
          />
        </Field>
      </div>
    </div>
  );
}
