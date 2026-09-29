"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select, fieldClass } from "@/components/ui/form-controls";
import { billToFromClient, type BillTo } from "@/lib/bill-to";
import { CURRENCIES, addDays, cn, formatMoney, round2, toDateInput } from "@/lib/utils";
import type { ComposerInput, ComposerLine } from "@/lib/composer";
import { useI18n } from "@/components/i18n/locale-provider";
import { FxRateNote, type FxState } from "@/components/invoices/fx-rate-note";
import { createManualInvoice, nextNumber } from "./actions";

type Company = { id: string; code: string; name: string; defaultLang: "EN" | "ZH" };
type Account = { id: string; label: string; currency: string; compact: boolean };
type Rule = { companyId: string | null; currency: string | null; bankAccountId: string };
type ClientOpt = {
  id: string;
  name: string;
  alias: string;
  agreementNo: string;
  directorName: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  country: string;
  defaultOwnerId: string | null;
  fees: Record<string, unknown>;
};
type Item = { id: string; labelEn: string; labelZh: string; detailHint: string; clientFee: string };

type Line = ComposerLine & { key: number };

const blankLine = (key: number): Line => ({ key, itemId: "", description: "", detail: "", rate: "", quantity: "1" });
const num = (v: string) => {
  const x = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
};

/** Same precedence as the server: company + currency, company, currency. */
function resolveAccount(rules: Rule[], companyId: string, currency: string) {
  const score = (r: Rule) => (r.companyId ? 2 : 0) + (r.currency ? 1 : 0);
  return (
    rules
      .filter((r) => (r.companyId === null || r.companyId === companyId) && (r.currency === null || r.currency === currency))
      .sort((a, b) => score(b) - score(a))[0]?.bankAccountId ?? ""
  );
}

function feeNumber(v: unknown) {
  const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? m[0] : "";
}

export function Composer({
  initialClientId,
  companies,
  accounts,
  rules,
  clients,
  items,
  types,
  owners,
  rates,
  ratesUpdatedAt,
}: {
  initialClientId: string;
  companies: Company[];
  accounts: Account[];
  rules: Rule[];
  clients: ClientOpt[];
  items: Item[];
  types: { id: string; name: string; subtypeHint: string }[];
  owners: { id: string; name: string }[];
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const today = new Date();
  const keyRef = useRef(1);

  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [language, setLanguage] = useState<"EN" | "ZH">(companies[0]?.defaultLang ?? "EN");
  const [clientText, setClientText] = useState("");
  const [clientId, setClientId] = useState("");
  const [billTo, setBillTo] = useState<BillTo>({ name: "", attention: "", lines: [] });
  const [number, setNumber] = useState("");
  const [reference, setReference] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(toDateInput(today));
  const [dueDate, setDueDate] = useState(toDateInput(addDays(today, 7)));
  const [currency, setCurrency] = useState<ComposerInput["currency"]>("USD");
  const [lines, setLines] = useState<Line[]>([blankLine(0)]);
  const [taxAmount, setTaxAmount] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [altCurrency, setAltCurrency] = useState("");
  const [altAmount, setAltAmount] = useState("");
  const [altTouched, setAltTouched] = useState(false);
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankTouched, setBankTouched] = useState(false);
  const [extraAccountIds, setExtraAccountIds] = useState<string[]>([]);
  const [typeId, setTypeId] = useState("");
  const [subtype, setSubtype] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [alias, setAlias] = useState("");
  const [usdAmount, setUsdAmount] = useState("");
  const [usdTouched, setUsdTouched] = useState(false);
  const [fx, setFx] = useState<FxState>({ rates, updatedAt: ratesUpdatedAt });

  const [error, setError] = useState<string | null>(null);
  const [reuse, setReuse] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, start] = useTransition();

  const clientByName = useMemo(() => new Map(clients.map((c) => [c.name.toLowerCase(), c])), [clients]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const client = clients.find((c) => c.id === clientId);
  const payable = altCurrency || currency;

  const subtotal = round2(lines.reduce((s, l) => s + round2(num(l.rate) * (num(l.quantity) || 1)) * (l.description.trim() ? 1 : 0), 0));
  const total = round2(subtotal + num(taxAmount));
  const due = round2(total - num(amountPaid));
  const altRate = altCurrency && fx.rates[currency] && fx.rates[altCurrency] ? fx.rates[currency] / fx.rates[altCurrency] : null;
  const suggestedAlt = altRate ? String(round2(due * altRate)) : "";
  const suggestedUsd = fx.rates[currency] ? String(round2(total * fx.rates[currency])) : "";

  useEffect(() => {
    if (!bankTouched) setBankAccountId(resolveAccount(rules, companyId, payable));
  }, [companyId, payable, rules, bankTouched]);
  useEffect(() => {
    if (!altTouched) setAltAmount(suggestedAlt);
  }, [suggestedAlt, altTouched]);
  useEffect(() => {
    if (!usdTouched) setUsdAmount(suggestedUsd);
  }, [suggestedUsd, usdTouched]);

  function label(item: Item, lang: "EN" | "ZH") {
    return lang === "ZH" && item.labelZh ? item.labelZh : item.labelEn;
  }

  function pickCompany(id: string) {
    setCompanyId(id);
    const c = companies.find((x) => x.id === id);
    if (c) switchLanguage(c.defaultLang);
  }

  function switchLanguage(lang: "EN" | "ZH") {
    setLanguage(lang);
    setLines((prev) =>
      prev.map((l) => {
        const item = itemById.get(l.itemId);
        if (!item || (l.description !== item.labelEn && l.description !== item.labelZh)) return l;
        return { ...l, description: label(item, lang) };
      })
    );
  }

  function pickClient(text: string) {
    setClientText(text);
    const c = clientByName.get(text.trim().toLowerCase());
    setClientId(c?.id ?? "");
    if (!c) return;
    setBillTo(billToFromClient(c));
    setReference(c.agreementNo);
    setAlias(c.alias);
    setOwnerId(c.defaultOwnerId ?? "");
    setLines((prev) => prev.map((l) => withClientRate(l, c)));
    start(async () => setNumber(await nextNumber(c.id)));
  }

  function withClientRate(l: Line, c: ClientOpt | undefined): Line {
    const item = itemById.get(l.itemId);
    if (!item?.clientFee || !c) return l;
    const fee = feeNumber(c.fees[item.clientFee]);
    return fee ? { ...l, rate: fee } : l;
  }

  useEffect(() => {
    const c = clients.find((x) => x.id === initialClientId);
    if (c) pickClient(c.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId]);

  function setLine(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickItem(key: number, itemId: string) {
    const item = itemById.get(itemId);
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        if (!item) return { ...l, itemId: "" };
        return withClientRate({ ...l, itemId, description: label(item, language), detail: l.detail || item.detailHint }, client);
      })
    );
  }

  const input: ComposerInput = {
    companyId,
    language,
    clientId,
    billTo,
    number,
    reference,
    invoiceDate,
    dueDate,
    currency,
    lines: lines.map(({ itemId, description, detail, rate, quantity }) => ({ itemId, description, detail, rate, quantity })),
    taxAmount,
    amountPaid,
    altCurrency,
    altAmount,
    bankAccountId,
    extraAccountIds,
    typeId,
    subtype,
    ownerId,
    alias,
    usdAmount,
  };
  const inputKey = JSON.stringify(input);

  useEffect(() => {
    if (!billTo.name || !number || !lines.some((l) => l.description.trim())) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const res = await fetch("/api/invoices/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: inputKey,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setPreviewError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Preview failed.");
          return;
        }
        const url = URL.createObjectURL(await res.blob());
        setPreviewError(null);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPreviewError("Preview failed.");
      } finally {
        setPreviewing(false);
      }
    }, 900);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  function save() {
    setError(null);
    start(async () => {
      const res = await createManualInvoice(input, Boolean(reuse));
      if (!res.ok) return setError(res.error);
      if (res.reuse) return setReuse(res.reuse);
      const a = document.createElement("a");
      a.href = `/api/invoices/${res.id}/pdf`;
      a.click();
      router.push(`/invoices/${res.id}`);
    });
  }

  const mainAccounts = accounts.filter((a) => !a.compact);
  const compactAccounts = accounts.filter((a) => a.compact);
  const type = types.find((ty) => ty.id === typeId);
  const card = "glass-panel neon-edge rounded-card p-5";
  const title = "mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft";

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className={card}>
          <h2 className={title}>{t("Issuer")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={companyId} options={companies.map((c) => ({ value: c.id, label: c.code }))} onChange={pickCompany} />
            <Segmented
              value={language}
              options={[
                { value: "EN", label: "English" },
                { value: "ZH", label: "中文" },
              ]}
              onChange={switchLanguage}
            />
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">{companies.find((c) => c.id === companyId)?.name}</p>
        </section>

        <section className={card}>
          <h2 className={title}>{t("Bill to")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Client *">
                <input
                  list="composer-clients"
                  value={clientText}
                  onChange={(e) => pickClient(e.target.value)}
                  placeholder={t("Type to search")}
                  className={cn(fieldClass, clientText && !clientId && "border-amber-400/60")}
                />
                <datalist id="composer-clients">
                  {clients.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
            </div>
            <Field label="Attention">
              <input value={billTo.attention} onChange={(e) => setBillTo({ ...billTo, attention: e.target.value })} className={fieldClass} />
            </Field>
            <Field label="Name on invoice">
              <input value={billTo.name} onChange={(e) => setBillTo({ ...billTo, name: e.target.value })} className={fieldClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address" hint="One line per row. Edits here apply to this invoice only.">
                <textarea
                  value={billTo.lines.join("\n")}
                  onChange={(e) => setBillTo({ ...billTo, lines: e.target.value.split("\n") })}
                  rows={3}
                  className={cn(fieldClass, "h-auto py-2")}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className={card}>
          <h2 className={title}>{t("Invoice")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Invoice no. *">
              <input value={number} onChange={(e) => { setNumber(e.target.value); setReuse(null); }} className={cn(fieldClass, "font-mono")} />
            </Field>
            <Field label="Reference">
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={cn(fieldClass, "font-mono")} />
            </Field>
            <Field label="Date of issue *">
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => {
                  setInvoiceDate(e.target.value);
                  if (e.target.value) setDueDate(toDateInput(addDays(new Date(`${e.target.value}T00:00:00Z`), 7)));
                }}
                className={fieldClass}
              />
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
            </Field>
            <Field label="Currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value as ComposerInput["currency"])}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <FxRateNote className="mt-3" currencies={[currency, altCurrency]} fx={fx} onChange={setFx} />
        </section>

        <section className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Lines")}</h2>
            <Button size="sm" variant="secondary" onClick={() => setLines((p) => [...p, blankLine(keyRef.current++)])}>
              <Plus className="h-3.5 w-3.5" />
              {t("Add line")}
            </Button>
          </div>
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.key} className="rounded-card border border-line/70 p-3">
                <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_36px]">
                  <Select value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)} aria-label={t("Item")}>
                    <option value="">{t("Custom line")}</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.labelEn}
                      </option>
                    ))}
                  </Select>
                  <input
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                    placeholder={t("Description")}
                    className={cn(fieldClass, "font-medium")}
                  />
                  <button
                    onClick={() => setLines((p) => (p.length > 1 ? p.filter((x) => x.key !== l.key) : [blankLine(keyRef.current++)]))}
                    aria-label={t("Remove line")}
                    className="flex h-10 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-rose-600 dark:hover:text-rose-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_90px_120px]">
                  <input
                    value={l.detail}
                    onChange={(e) => setLine(l.key, { detail: e.target.value })}
                    placeholder={t("Detail line (optional), e.g. month, channel, website")}
                    className={cn(fieldClass, "text-[13px]")}
                  />
                  <input
                    inputMode="decimal"
                    value={l.rate}
                    onChange={(e) => setLine(l.key, { rate: e.target.value })}
                    placeholder={t("Rate")}
                    className={cn(fieldClass, "tnum text-right")}
                  />
                  <input
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                    placeholder={t("Qty")}
                    className={cn(fieldClass, "tnum text-right")}
                  />
                  <div className="tnum flex h-10 items-center justify-end px-1 text-sm text-ink">
                    {formatMoney(round2(num(l.rate) * (num(l.quantity) || 1)))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-soft">{t("Use a negative rate for adjustments; it prints in parentheses.")}</p>

          <div className="mt-5 ml-auto grid max-w-sm gap-2 text-sm">
            <div className="flex justify-between text-ink-muted">
              <span>{t("Subtotal")}</span>
              <span className="tnum text-ink">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <span>{t("Tax")}</span>
              <input inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0.00" className={cn(fieldClass, "tnum h-8 w-32 text-right")} />
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <span>{t("Amount paid")}</span>
              <input inputMode="decimal" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" className={cn(fieldClass, "tnum h-8 w-32 text-right")} />
            </div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
              <span>{t("Amount due ({0})", currency)}</span>
              <span className="tnum">{formatMoney(due)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <Select
                value={altCurrency}
                onChange={(e) => {
                  setAltCurrency(e.target.value);
                  setAltTouched(false);
                }}
                className="h-8 w-44 text-[13px]"
              >
                <option value="">{t("No second amount")}</option>
                {CURRENCIES.filter((c) => c !== currency).map((c) => (
                  <option key={c} value={c}>
                    {t("Also due in {0}", c)}
                  </option>
                ))}
              </Select>
              {altCurrency && (
                <input
                  inputMode="decimal"
                  value={altAmount}
                  onChange={(e) => {
                    setAltTouched(true);
                    setAltAmount(e.target.value);
                  }}
                  className={cn(fieldClass, "tnum h-8 w-32 text-right")}
                />
              )}
            </div>
            {altCurrency && altRate && (
              <p className="text-right text-[12px] text-ink-soft">
                {t("At {0} {1} per {2}. Overwrite to use the agreed figure.", round2(altRate * 10000) / 10000, altCurrency, currency)}
              </p>
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className={title}>{t("Payment details")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pay to" hint={bankTouched ? t("Chosen by hand") : t("Default for {0} in {1}. Change the rules in Settings.", companies.find((c) => c.id === companyId)?.code ?? "", payable)}>
              <Select
                value={bankAccountId}
                onChange={(e) => {
                  setBankTouched(true);
                  setBankAccountId(e.target.value);
                }}
              >
                <option value="">{t("No bank details")}</option>
                {mainAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            {compactAccounts.length > 0 && (
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink">{t("Also show")}</p>
                <div className="space-y-1.5">
                  {compactAccounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={extraAccountIds.includes(a.id)}
                        onChange={(e) =>
                          setExtraAccountIds((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)))
                        }
                        className="h-4 w-4 accent-brand-500"
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className={title}>{t("Ledger")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">—</option>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subtype">
              <input value={subtype} onChange={(e) => setSubtype(e.target.value)} placeholder={type?.subtypeHint || t("Explains the type")} className={fieldClass} />
            </Field>
            <Field label="Owner">
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alias">
              <input value={alias} onChange={(e) => setAlias(e.target.value)} className={cn(fieldClass, "font-mono uppercase")} />
            </Field>
            {currency !== "USD" && (
              <Field label="USD equivalent" hint="Booked on the ledger. Suggested from the exchange rate shown under Currency.">
                <input
                  inputMode="decimal"
                  value={usdAmount}
                  onChange={(e) => {
                    setUsdTouched(true);
                    setUsdAmount(e.target.value);
                  }}
                  className={cn(fieldClass, "tnum text-right")}
                />
              </Field>
            )}
          </div>
        </section>

        {error && <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-200">{t(error)}</p>}
        {reuse && <p className="rounded-control border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-200">{t(reuse)}</p>}
        <div className="flex items-center gap-2 pb-4">
          <Button size="lg" onClick={save} loading={pending}>
            <FileDown className="h-4 w-4" />
            {t(reuse ? "Issue anyway" : "Save and download PDF")}
          </Button>
          <span className="text-[13px] text-ink-soft">{t("Adds the invoice to the ledger as Manual, status Sent.")}</span>
        </div>
      </div>

      <div className="2xl:sticky 2xl:top-6 2xl:self-start">
        <div className={cn(card, "p-3")}>
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Preview")}</span>
            {previewing && <Loader2 className="h-4 w-4 animate-spin text-ink-soft" />}
          </div>
          {previewError && <p className="mx-2 mb-2 text-[13px] text-amber-700 dark:text-amber-200">{t(previewError)}</p>}
          {previewUrl ? (
            <iframe src={`${previewUrl}#toolbar=0&view=FitH`} title={t("Invoice preview")} className="h-[80vh] w-full rounded-control bg-white" />
          ) : (
            <div className="flex h-[50vh] items-center justify-center rounded-control border border-dashed border-overlay/15 text-center text-[13px] text-ink-soft">
              {t("Pick a client and add a line to see the PDF.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
