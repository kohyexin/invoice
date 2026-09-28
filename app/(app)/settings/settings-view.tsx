"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Coins, Landmark, ListChecks, Plus, Route, Tags, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordPanel } from "@/components/ui/record-panel";
import { SETTINGS_ENTITIES, type FieldDef, type SettingsEntity } from "@/lib/settings-config";
import { cn, formatDate } from "@/lib/utils";
import { deleteSetting, saveSetting } from "./actions";

type Row = Record<string, unknown> & { id: string };

type Column = { label: string; render: (r: Row) => React.ReactNode; mono?: boolean; align?: "right" };

type Tab = {
  id: SettingsEntity;
  label: string;
  icon: React.ElementType;
  description: string;
  rows: Row[];
  columns: Column[];
  canDelete?: boolean;
};

const inactive = (r: Row) => (r.active === false ? <Badge tone="neutral">Inactive</Badge> : null);

export function SettingsView(props: {
  companies: Row[];
  bankAccounts: Row[];
  rules: Row[];
  fx: Row[];
  owners: Row[];
  types: Row[];
  items: Row[];
}) {
  const router = useRouter();
  const [tabId, setTabId] = useState<SettingsEntity>("company");
  const [editing, setEditing] = useState<{ entity: SettingsEntity; row: Row | null } | null>(null);

  const options = useMemo(
    () => ({
      companies: props.companies.map((c) => ({ value: c.id, label: String(c.legalName) })),
      bankAccounts: props.bankAccounts.map((b) => ({ value: b.id, label: String(b.label) })),
    }),
    [props.companies, props.bankAccounts]
  );

  const tabs: Tab[] = [
    {
      id: "company",
      label: "Companies",
      icon: Building2,
      description: "Issuers printed on the invoice letterhead.",
      rows: props.companies,
      columns: [
        { label: "Code", render: (r) => String(r.code), mono: true },
        { label: "Legal name", render: (r) => <span className="flex items-center gap-2">{String(r.legalName)} {inactive(r)}</span> },
        { label: "Address", render: (r) => (r.addressLines as string[]).join(", ") },
        { label: "Language", render: (r) => (r.defaultLang === "ZH" ? "Chinese" : "English") },
      ],
    },
    {
      id: "bankAccount",
      label: "Bank accounts",
      icon: Landmark,
      description: "Accounts that can appear under Payment Details.",
      rows: props.bankAccounts,
      columns: [
        { label: "Label", render: (r) => <span className="flex items-center gap-2">{String(r.label)} {r.compact ? <Badge tone="outline">Compact</Badge> : null} {inactive(r)}</span> },
        { label: "Currency", render: (r) => String(r.currency), mono: true },
        { label: "Account name", render: (r) => String(r.accountName) },
        { label: "Account number", render: (r) => String(r.accountNumber), mono: true },
        { label: "Bank", render: (r) => String(r.bankName || "—") },
      ],
    },
    {
      id: "paymentRule",
      label: "Payment defaults",
      icon: Route,
      description:
        "Which account an invoice uses by default. Company and currency together beat company only, which beats currency only. The payable currency is used (the second amount-due currency when there is one).",
      rows: props.rules,
      columns: [
        { label: "Company", render: (r) => (r.companyName ? String(r.companyName) : <span className="text-ink-soft">Any</span>) },
        { label: "Currency", render: (r) => (r.currency ? String(r.currency) : <span className="text-ink-soft">Any</span>), mono: true },
        { label: "Bank account", render: (r) => String(r.accountLabel) },
      ],
    },
    {
      id: "fxRate",
      label: "FX rates",
      icon: Coins,
      description: "Used to suggest the USD equivalent of non-USD invoices. You can still override the booked USD on each invoice.",
      rows: props.fx,
      columns: [
        { label: "Currency", render: (r) => String(r.currency), mono: true },
        { label: "Units per 1 USD", render: (r) => String(r.perUsd), mono: true, align: "right" },
        { label: "Updated", render: (r) => formatDate(String(r.updatedAt)), align: "right" },
      ],
    },
    {
      id: "owner",
      label: "Owners",
      icon: UserRound,
      description: "Account owners assigned to clients and invoices.",
      rows: props.owners,
      columns: [{ label: "Name", render: (r) => <span className="flex items-center gap-2">{String(r.name)} {inactive(r)}</span> }],
    },
    {
      id: "invoiceType",
      label: "Invoice types",
      icon: Tags,
      description: "Type of each invoice. The subtype is free text; the hint tells you what to write for that type.",
      rows: props.types,
      columns: [
        { label: "Name", render: (r) => <span className="flex items-center gap-2">{String(r.name)} {inactive(r)}</span> },
        { label: "Subtype hint", render: (r) => (r.subtypeHint ? String(r.subtypeHint) : <span className="text-ink-soft">—</span>) },
      ],
    },
    {
      id: "invoiceItem",
      label: "Invoice items",
      icon: ListChecks,
      description: "Line items for manual invoices, with the English and Chinese label printed for each language.",
      rows: props.items,
      columns: [
        { label: "English", render: (r) => <span className="flex items-center gap-2">{String(r.labelEn)} {inactive(r)}</span> },
        { label: "Chinese", render: (r) => (r.labelZh ? String(r.labelZh) : <span className="text-ink-soft">Uses English</span>) },
        { label: "Detail hint", render: (r) => (r.detailHint ? String(r.detailHint) : "—") },
        { label: "Client fee", render: (r) => (r.clientFee ? String(r.clientFee) : "—"), mono: true },
      ],
    },
  ];

  const tab = tabs.find((t) => t.id === tabId)!;
  const config = editing ? SETTINGS_ENTITIES[editing.entity] : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTabId(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors",
                t.id === tabId
                  ? "bg-brand-500/15 text-brand-200 shadow-[inset_0_0_0_1px_rgb(var(--brand-400)/0.3)]"
                  : "text-ink-muted hover:bg-overlay/[0.05] hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              <span className="ml-auto font-mono text-[11px] text-ink-soft">{t.rows.length}</span>
            </button>
          );
        })}
      </nav>

      <section className="glass-panel neon-edge rounded-card">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{tab.label}</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] text-ink-muted">{tab.description}</p>
          </div>
          <Button size="sm" onClick={() => setEditing({ entity: tab.id, row: null })}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        <div className="overflow-x-auto px-5 pb-2">
          <table className="tnum w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                {tab.columns.map((c) => (
                  <th
                    key={c.label}
                    className={cn(
                      "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft first:pl-0 last:pr-0",
                      c.align === "right" ? "text-right" : "text-left"
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tab.rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditing({ entity: tab.id, row: r })}
                  className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-overlay/[0.03]"
                >
                  {tab.columns.map((c) => (
                    <td
                      key={c.label}
                      className={cn(
                        "px-3 py-3 text-ink first:pl-0 last:pr-0",
                        c.mono && "font-mono text-[13px]",
                        c.align === "right" && "text-right"
                      )}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {tab.rows.length === 0 && (
                <tr>
                  <td colSpan={tab.columns.length} className="py-10 text-center text-[13px] text-ink-soft">
                    Nothing here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && config && (
        <RecordPanel
          open
          title={`${editing.row ? "Edit" : "Add"} ${config.title.toLowerCase()}`}
          fields={config.fields as FieldDef[]}
          initial={editing.row}
          options={options}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const res = await saveSetting(editing.entity, editing.entity === "fxRate" ? null : editing.row?.id ?? null, values);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
          onDelete={
            editing.row
              ? async () => {
                  const res = await deleteSetting(editing.entity, editing.row!.id);
                  if (!res.ok) return res.error;
                  router.refresh();
                  return null;
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
