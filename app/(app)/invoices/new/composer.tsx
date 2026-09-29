"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, FileDown, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Segmented, Select, fieldClass } from "@/components/ui/form-controls";
import { billToFromClient, type BillTo } from "@/lib/bill-to";
import { CURRENCIES, addDays, cn, formatMoney, ledgerSubtype, round2, toDateInput } from "@/lib/utils";
import type { ComposerInput, ComposerLine } from "@/lib/composer";
import { useI18n } from "@/components/i18n/locale-provider";
import { FxRateNote, type FxState } from "@/components/invoices/fx-rate-note";
import { PreviewDrawer } from "@/components/invoices/preview-drawer";
import { createManualInvoice, nextNumber, updateManualInvoice } from "./actions";

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
type Item = { id: string; labelEn: string; labelZh: string; detailHint: string; clientFee: string; typeId: string; subtype: string };

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
  defaultOwnerId,
  aliases,
  rates,
  ratesUpdatedAt,
  editing,
}: {
  initialClientId: string;
  companies: Company[];
  accounts: Account[];
  rules: Rule[];
  clients: ClientOpt[];
  items: Item[];
  types: { id: string; name: string; subtypeHint: string }[];
  owners: { id: string; name: string }[];
  defaultOwnerId: string;
  /** Aliases each client's invoices have used, most used first. */
  aliases: Record<string, string[]>;
  rates: Record<string, number>;
  ratesUpdatedAt: string | null;
  editing?: { id: string; input: ComposerInput; clientName: string };
}) {
  const router = useRouter();
  const { t } = useI18n();
  const today = new Date();
  const init = editing?.input;
  const keyRef = useRef(init?.lines.length ?? 1);

  const [companyId, setCompanyId] = useState(init?.companyId ?? companies[0]?.id ?? "");
  const [language, setLanguage] = useState<"EN" | "ZH">(init?.language ?? companies[0]?.defaultLang ?? "EN");
  const [clientText, setClientText] = useState(editing?.clientName ?? "");
  const [clientId, setClientId] = useState(init?.clientId ?? "");
  const [billTo, setBillTo] = useState<BillTo>(init?.billTo ?? { name: "", attention: "", lines: [] });
  const [number, setNumber] = useState(init?.number ?? "");
  const [reference, setReference] = useState(init?.reference ?? "");
  const [invoiceDate, setInvoiceDate] = useState(init?.invoiceDate ?? toDateInput(today));
  const [dueDate, setDueDate] = useState(init ? init.dueDate : toDateInput(addDays(today, 7)));
  const [currency, setCurrency] = useState<ComposerInput["currency"]>(init?.currency ?? "USD");
  const [lines, setLines] = useState<Line[]>(init ? init.lines.map((l, key) => ({ ...l, key })) : [blankLine(0)]);
  const [taxAmount, setTaxAmount] = useState(init?.taxAmount ?? "");
  const [amountPaid, setAmountPaid] = useState(init?.amountPaid ?? "");
  const [altCurrency, setAltCurrency] = useState(init?.altCurrency ?? "");
  const [altAmount, setAltAmount] = useState(init?.altAmount ?? "");
  const [altTouched, setAltTouched] = useState(Boolean(init?.altCurrency));
  const [bankAccountId, setBankAccountId] = useState(init?.bankAccountId ?? "");
  const [bankTouched, setBankTouched] = useState(Boolean(init));
  const [extraAccountIds, setExtraAccountIds] = useState<string[]>(init?.extraAccountIds ?? []);
  const [typeId, setTypeId] = useState(init?.typeId ?? "");
  const [typeTouched, setTypeTouched] = useState(Boolean(init?.typeId));
  const [subtype, setSubtype] = useState(init?.subtype ?? "");
  const [subtypeTouched, setSubtypeTouched] = useState(Boolean(init?.subtype));
  const [ownerId, setOwnerId] = useState(init?.ownerId || clients.find((c) => c.id === init?.clientId)?.defaultOwnerId || defaultOwnerId);
  const [alias, setAlias] = useState(init?.alias ?? "");
  const [usdAmount, setUsdAmount] = useState(init?.usdAmount ?? "");
  const [usdTouched, setUsdTouched] = useState(Boolean(init && init.currency !== "USD"));
  const [fx, setFx] = useState<FxState>({ rates, updatedAt: ratesUpdatedAt });

  const [error, setError] = useState<string | null>(null);
  const [reuse, setReuse] = useState<string | null>(null);
  const [downloadAfterSave, setDownloadAfterSave] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, start] = useTransition();

  const clientByName = useMemo(() => new Map(clients.map((c) => [c.name.toLowerCase(), c])), [clients]);
  /** Alias -> client. An alias used by more than one client is left out rather than guessed. */
  const clientByAlias = useMemo(() => {
    const owners = new Map<string, Set<string>>();
    const add = (alias: string, id: string) => {
      const key = alias.trim().toLowerCase();
      if (key) owners.set(key, (owners.get(key) ?? new Set()).add(id));
    };
    for (const c of clients) add(c.alias, c.id);
    for (const [id, list] of Object.entries(aliases)) list.forEach((a) => add(a, id));
    const byId = new Map(clients.map((c) => [c.id, c]));
    const map = new Map<string, ClientOpt>();
    owners.forEach((ids, key) => {
      if (ids.size === 1 && byId.has([...ids][0])) map.set(key, byId.get([...ids][0])!);
    });
    return map;
  }, [clients, aliases]);
  const aliasOptions = useMemo(
    () =>
      [...clientByAlias.entries()]
        .map(([key, c]) => ({ alias: [c.alias, ...(aliases[c.id] ?? [])].find((a) => a.toLowerCase() === key) ?? key.toUpperCase(), client: c }))
        .filter((o) => o.alias.toLowerCase() !== o.client.name.toLowerCase())
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    [clientByAlias, aliases]
  );
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

  /** Accepts the client's name or any alias it has used; an alias is also kept as this invoice's alias. */
  function pickClient(text: string) {
    setClientText(text);
    const key = text.trim().toLowerCase();
    const byName = clientByName.get(key);
    const c = byName ?? clientByAlias.get(key);
    const typedAlias = !byName && c ? text.trim().toUpperCase() : "";
    setClientId(c?.id ?? "");
    if (!c) return;
    if (c.id === clientId) {
      if (typedAlias) setAlias(typedAlias);
      return;
    }
    setBillTo(billToFromClient(c));
    setReference(c.agreementNo);
    setAlias(typedAlias || c.alias || aliases[c.id]?.[0] || "");
    setOwnerId(c.defaultOwnerId ?? defaultOwnerId);
    setLines((prev) => prev.map((l) => withClientRate(l, c)));
    if (!editing) start(async () => setNumber(await nextNumber(c.id)));
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

  const leadLine = lines.find((l) => l.itemId);
  const leadItem = itemById.get(leadLine?.itemId ?? "");
  const suggestedType = leadItem?.typeId ?? "";
  const suggestedSubtype = leadItem ? ledgerSubtype(leadItem.subtype, invoiceDate, leadLine?.detail) : "";
  useEffect(() => {
    if (!typeTouched && suggestedType) setTypeId(suggestedType);
    if (!subtypeTouched && suggestedType) setSubtype(suggestedSubtype);
  }, [suggestedType, suggestedSubtype, typeTouched, subtypeTouched]);

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

  function save(download: boolean) {
    setError(null);
    setDownloadAfterSave(download);
    start(async () => {
      const res = editing ? await updateManualInvoice(editing.id, input, Boolean(reuse)) : await createManualInvoice(input, Boolean(reuse));
      if (!res.ok) return setError(res.error);
      if (res.reuse) return setReuse(res.reuse);
      if (download) {
        const a = document.createElement("a");
        a.href = `/api/invoices/${res.id}/pdf`;
        a.click();
      }
      router.push(`/invoices/${res.id}`);
      if (editing) router.refresh();
    });
  }

  const mainAccounts = accounts.filter((a) => !a.compact);
  const compactAccounts = accounts.filter((a) => a.compact);
  const type = types.find((ty) => ty.id === typeId);
  const clientAliases = [...new Set([client?.alias ?? "", ...(aliases[clientId] ?? [])].filter(Boolean))];
  const ownerFromClient = Boolean(client?.defaultOwnerId) && ownerId === client?.defaultOwnerId;
  const ownerHint = !ownerId
    ? ""
    : ownerFromClient
      ? t("The client's default owner")
      : ownerId === defaultOwnerId && !client?.defaultOwnerId
        ? t("Default owner. Saved to the client when you issue.")
        : "";
  const aliasHint = !client
    ? ""
    : client.alias
      ? alias.trim().toUpperCase() === client.alias
        ? t("The client's alias")
        : t("The client's alias is {0}", client.alias)
      : alias.trim()
        ? t("Saved to the client as its alias when you issue.")
        : t("No alias saved for this client yet.");
  const typeHint = typeId && typeId === suggestedType && !typeTouched && leadItem ? t("From the line item {0}", leadItem.labelEn) : "";
  const card = "glass-panel neon-edge rounded-card p-5";
  const title = "mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft";

  return (
    <div>
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
              <Field label="Client *" hint={client && clientText !== client.name ? t("Alias of {0}", client.name) : undefined}>
                <input
                  list="composer-clients"
                  value={clientText}
                  onChange={(e) => pickClient(e.target.value)}
                  onBlur={() => client && clientText !== client.name && setClientText(client.name)}
                  placeholder={t("Type the client name or alias")}
                  className={cn(fieldClass, clientText && !clientId && "border-amber-400/60")}
                />
                <datalist id="composer-clients">
                  {clients.map((c) => (
                    <option key={c.id} value={c.name} label={c.alias || undefined} />
                  ))}
                  {aliasOptions.map((o) => (
                    <option key={`alias-${o.alias}`} value={o.alias} label={o.client.name} />
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
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <Field label="Invoice no. *">
                <input value={number} onChange={(e) => { setNumber(e.target.value); setReuse(null); }} className={cn(fieldClass, "font-mono")} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Reference">
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("Agreement no.")} className={cn(fieldClass, "font-mono")} />
              </Field>
            </div>
            <div className="sm:col-span-2">
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
            </div>
            <div className="sm:col-span-2">
              <Field label="Due date">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Currency">
                <Select value={currency} onChange={(e) => setCurrency(e.target.value as ComposerInput["currency"])}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <FxRateNote className="mt-3" currencies={[currency, altCurrency]} fx={fx} onChange={setFx} />
        </section>

        <section className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">{t("Lines")}</h2>
            <span className="text-[12px] text-ink-soft">{t("Use a negative rate for adjustments; it prints in parentheses.")}</span>
          </div>

          <div className="hidden gap-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft md:grid md:grid-cols-[minmax(0,1fr)_112px_72px_112px_36px]">
            <span>{t("Item and description")}</span>
            <span className="text-right">{t("Rate")}</span>
            <span className="text-right">{t("Qty")}</span>
            <span className="text-right">{t("Amount")}</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 border-b border-line/60 py-3 md:grid-cols-[minmax(0,1fr)_112px_72px_112px_36px] md:items-start">
              <div className="min-w-0 space-y-2">
                <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)]">
                  <Select value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)} aria-label={t("Item")}>
                    <option value="">{t("Custom line")}</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.labelEn}
                      </option>
                    ))}
                  </Select>
                  <input
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                    placeholder={t("Description printed on the invoice")}
                    aria-label={t("Description")}
                    className={cn(fieldClass, "font-medium")}
                  />
                </div>
                <input
                  value={l.detail}
                  onChange={(e) => setLine(l.key, { detail: e.target.value })}
                  placeholder={t(itemById.get(l.itemId)?.detailHint || "Detail line (optional), e.g. month, channel, website")}
                  aria-label={t("Detail line")}
                  className={cn(fieldClass, "h-9 text-[13px]")}
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)_36px] gap-2 md:contents">
                <input
                  inputMode="decimal"
                  value={l.rate}
                  onChange={(e) => setLine(l.key, { rate: e.target.value })}
                  placeholder="0.00"
                  aria-label={t("Rate")}
                  className={cn(fieldClass, "tnum text-right")}
                />
                <input
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  placeholder="1"
                  aria-label={t("Qty")}
                  className={cn(fieldClass, "tnum text-right")}
                />
                <div className="tnum flex h-10 items-center justify-end text-sm font-medium text-ink">
                  {formatMoney(round2(num(l.rate) * (num(l.quantity) || 1)))}
                </div>
                <button
                  onClick={() => setLines((p) => (p.length > 1 ? p.filter((x) => x.key !== l.key) : [blankLine(keyRef.current++)]))}
                  aria-label={t("Remove line {0}", i + 1)}
                  className="flex h-10 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-rose-600 dark:hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLines((p) => [...p, blankLine(keyRef.current++)])}>
            <Plus className="h-3.5 w-3.5" />
            {t("Add line")}
          </Button>

          <div className="ml-auto mt-4 w-full max-w-sm space-y-2.5 rounded-card border border-line/70 bg-overlay/[0.02] p-4 text-sm">
            <div className="flex h-9 items-center justify-between text-ink-muted">
              <span>{t("Subtotal")}</span>
              <span className="tnum font-medium text-ink">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <span>{t("Tax")}</span>
              <input inputMode="decimal" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder="0.00" className={cn(fieldClass, "tnum h-9 w-36 text-right")} />
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <span>{t("Amount paid")}</span>
              <input inputMode="decimal" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} placeholder="0.00" className={cn(fieldClass, "tnum h-9 w-36 text-right")} />
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3 text-base font-semibold text-ink">
              <span>{t("Amount due ({0})", currency)}</span>
              <span className="tnum">{formatMoney(due)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-ink-muted">
              <span>{t("Also due in")}</span>
              <Select
                value={altCurrency}
                onChange={(e) => {
                  setAltCurrency(e.target.value);
                  setAltTouched(false);
                }}
                className="h-9 w-36 text-[13px]"
              >
                <option value="">{t("None")}</option>
                {CURRENCIES.filter((c) => c !== currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            {altCurrency && (
              <>
                <div className="flex items-center justify-between gap-3 text-ink-muted">
                  <span>{t("Amount due ({0})", altCurrency)}</span>
                  <input
                    inputMode="decimal"
                    value={altAmount}
                    onChange={(e) => {
                      setAltTouched(true);
                      setAltAmount(e.target.value);
                    }}
                    className={cn(fieldClass, "tnum h-9 w-36 text-right")}
                  />
                </div>
                {altRate && (
                  <p className="text-right text-[12px] text-ink-soft">
                    {t("At {0} {1} per {2}. Overwrite to use the agreed figure.", round2(altRate * 10000) / 10000, altCurrency, currency)}
                  </p>
                )}
              </>
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
            <Field label="Type" hint={typeHint}>
              <Select
                value={typeId}
                onChange={(e) => {
                  setTypeTouched(true);
                  setTypeId(e.target.value);
                }}
              >
                <option value="">—</option>
                {types.map((ty) => (
                  <option key={ty.id} value={ty.id}>
                    {ty.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subtype" hint={type?.subtypeHint ? t("Write the {0}", type.subtypeHint.toLowerCase()) : undefined}>
              <input
                value={subtype}
                onChange={(e) => {
                  setSubtypeTouched(true);
                  setSubtype(e.target.value);
                }}
                placeholder={type?.subtypeHint || t("e.g. Monthly")}
                className={fieldClass}
              />
            </Field>
            <Field label="Owner" hint={ownerHint}>
              <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Alias" hint={aliasHint}>
              <input
                list="composer-aliases"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder={t("Short name, e.g. CIRCLEPAYMENT")}
                className={cn(fieldClass, "font-mono uppercase", client && !alias.trim() && "border-amber-400/60")}
              />
              <datalist id="composer-aliases">
                {clientAliases.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
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
          {reuse ? (
            <Button size="lg" onClick={() => save(downloadAfterSave)} loading={pending}>
              {downloadAfterSave ? <FileDown className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {t(editing ? "Save anyway" : "Issue anyway")}
            </Button>
          ) : (
            <>
              <Button size="lg" onClick={() => save(false)} loading={pending && !downloadAfterSave} disabled={pending}>
                <Save className="h-4 w-4" />
                {t(editing ? "Save changes" : "Save")}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => save(true)} loading={pending && downloadAfterSave} disabled={pending}>
                <FileDown className="h-4 w-4" />
                {t("Save and download PDF")}
              </Button>
            </>
          )}
          <Button size="lg" variant="secondary" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4" />
            {t("Preview")}
          </Button>
          {editing && (
            <Button size="lg" variant="ghost" onClick={() => router.push(`/invoices/${editing.id}`)} disabled={pending}>
              {t("Cancel")}
            </Button>
          )}
          <span className="text-[13px] text-ink-soft">
            {t(editing ? "Updates the ledger and replaces the PDF. Status and payment stay as they are." : "Adds the invoice to the ledger as Manual, status Sent.")}
          </span>
        </div>
      </div>

      <PreviewDrawer
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        url={previewUrl}
        loading={previewing}
        error={previewError}
        emptyText="Pick a client and add a line to see the PDF."
      />
    </div>
  );
}
