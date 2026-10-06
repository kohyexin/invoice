"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Coins, Copy, FolderTree, KeyRound, Landmark, ListChecks, Mail, Plus, RefreshCw, Route, ShieldCheck, Tags, UserPlus, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecordPanel } from "@/components/ui/record-panel";
import { ROLE_HELP, ROLE_LABEL, type RoleName } from "@/lib/roles";
import { ACCOUNT_USE_OPTIONS, CASH_KIND_OPTIONS, SETTINGS_ENTITIES, type FieldDef, type SettingsEntity } from "@/lib/settings-config";
import { cn, formatDate } from "@/lib/utils";
import { useI18n } from "@/components/i18n/locale-provider";
import { deleteSetting, saveSetting } from "./actions";
import { inviteUser, resendInvite, saveUser } from "./users-actions";
import { refreshRates } from "../invoices/fx-actions";

type Row = Record<string, unknown> & { id: string };

type Column = { label: string; render: (r: Row) => React.ReactNode; mono?: boolean; align?: "right" };

type TabId = SettingsEntity | "user";

const ROLES: RoleName[] = ["ADMIN", "STAFF", "VIEWER"];
type UserMode = "invite" | "pending" | "edit";

function userFields(t: (s: string) => string, mode: UserMode): FieldDef[] {
  const role: FieldDef = {
    key: "role",
    label: "Role",
    kind: "select",
    required: true,
    options: ROLES.map((r) => ({ value: r, label: `${t(ROLE_LABEL[r])}: ${t(ROLE_HELP[r])}` })),
  };
  if (mode === "invite")
    return [
      { key: "email", label: "Email", kind: "text", required: true, hint: "We'll email them a link to set their name and password. It is valid for 72 hours." },
      role,
      { key: "name", label: "Name", kind: "text", hint: "Optional. They can change it when they accept." },
    ];
  const base: FieldDef[] = [
    { key: "name", label: "Name", kind: "text", required: mode === "edit" },
    { key: "email", label: "Email", kind: "text", required: true, hint: "Used to sign in" },
    role,
  ];
  return mode === "pending" ? [...base, ...PENDING_USER_EXTRA] : [...base, ...EDIT_USER_EXTRA];
}

const INVITE_DEFAULTS = { role: "STAFF" };

const PENDING_USER_EXTRA: FieldDef[] = [
  { key: "active", label: "Active (untick to cancel the invitation)", kind: "checkbox" },
  { key: "resendInvite", label: "Resend invitation (the previous link stops working)", kind: "checkbox" },
];
const EDIT_USER_EXTRA: FieldDef[] = [
  { key: "active", label: "Active (untick to block sign-in and sign them out)", kind: "checkbox" },
  { key: "resetPassword", label: "Generate a new password and sign them out everywhere", kind: "checkbox" },
  { key: "resetTwoFactor", label: "Reset two-factor (they set up a new authenticator at next sign-in)", kind: "checkbox" },
];

const ROLE_TONE: Record<RoleName, "brand" | "outline" | "neutral"> = { ADMIN: "brand", STAFF: "outline", VIEWER: "neutral" };

type Tab = {
  id: TabId;
  label: string;
  icon: React.ElementType;
  description: string;
  rows: Row[];
  columns: Column[];
  canDelete?: boolean;
};

function Inactive({ row }: { row: Row }) {
  const { t } = useI18n();
  return row.active === false ? <Badge tone="neutral">{t("Inactive")}</Badge> : null;
}
const inactive = (r: Row) => <Inactive row={r} />;

const USE_LABEL = Object.fromEntries(ACCOUNT_USE_OPTIONS.map((o) => [o.value, o.label]));
const USE_TONE: Record<string, "brand" | "outline" | "neutral"> = { INVOICE: "neutral", BALANCE: "outline", BOTH: "brand" };
const KIND_LABEL = Object.fromEntries(CASH_KIND_OPTIONS.map((o) => [o.value, o.label]));
const KIND_TONE: Record<string, "success" | "danger" | "neutral"> = { INCOME: "success", EXPENSE: "danger", TRANSFER: "neutral" };

export function SettingsView(props: {
  companies: Row[];
  bankAccounts: Row[];
  rules: Row[];
  fx: Row[];
  owners: Row[];
  types: Row[];
  items: Row[];
  users: Row[];
  cashCategories: Row[];
  meId: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [tabId, setTabId] = useState<TabId>("user");
  const [editing, setEditing] = useState<{ entity: TabId; row: Row | null } | null>(null);
  const [issued, setIssued] = useState<
    { kind: "password"; email: string; password: string } | { kind: "invite"; email: string; link: string; emailed: "sent" | "logged" | "failed" } | null
  >(null);

  const options = useMemo(
    () => ({
      companies: props.companies.map((c) => ({ value: c.id, label: String(c.legalName) })),
      bankAccounts: props.bankAccounts.map((b) => ({ value: b.id, label: String(b.label) })),
      types: props.types.map((ty) => ({ value: ty.id, label: String(ty.name) })),
    }),
    [props.companies, props.bankAccounts, props.types]
  );
  const typeName = useMemo(() => new Map(props.types.map((ty) => [ty.id, String(ty.name)])), [props.types]);

  const tabs: Tab[] = [
    {
      id: "user",
      label: "Users",
      icon: ShieldCheck,
      description:
        "Who can sign in. Admin: everything, including users and settings. Staff: invoices, clients, payments and imports. Viewer: read-only. Disable people instead of deleting them so their name stays on the invoices they touched.",
      rows: props.users,
      columns: [
        {
          label: "Name",
          render: (r) => (
            <span className="flex items-center gap-2">
              {r.name ? String(r.name) : <span className="text-ink-soft">{t("Not set yet")}</span>}
              {r.id === props.meId && <Badge tone="outline">{t("You")}</Badge>}
              {r.active === false ? (
                <Badge tone="danger">{t("Disabled")}</Badge>
              ) : r.pending ? (
                r.inviteExpiresAt && new Date(String(r.inviteExpiresAt)) > new Date() ? (
                  <Badge tone="warning">{t("Invited (expires {0})", formatDate(String(r.inviteExpiresAt)))}</Badge>
                ) : (
                  <Badge tone="danger">{t("Invite expired")}</Badge>
                )
              ) : null}
            </span>
          ),
        },
        { label: "Email", render: (r) => String(r.email) },
        { label: "Role", render: (r) => <Badge tone={ROLE_TONE[r.role as RoleName]}>{t(ROLE_LABEL[r.role as RoleName])}</Badge> },
        {
          label: "Two-factor",
          render: (r) =>
            r.pending ? (
              <span className="text-ink-soft">—</span>
            ) : r.totpEnabledAt ? (
              <Badge tone="success">{t("On")}</Badge>
            ) : (
              <Badge tone="warning">{t("Set up at next sign-in")}</Badge>
            ),
        },
        {
          label: "Last sign-in",
          render: (r) => (r.lastLoginAt ? formatDate(String(r.lastLoginAt)) : <span className="text-ink-soft">{t("Never")}</span>),
          align: "right",
        },
      ],
    },
    {
      id: "company",
      label: "Companies",
      icon: Building2,
      description: "Issuers printed on the invoice letterhead, and companies that only hold cash for the balance sheet.",
      rows: props.companies,
      columns: [
        { label: "Code", render: (r) => String(r.code), mono: true },
        {
          label: "Legal name",
          render: (r) => (
            <span className="flex items-center gap-2">
              {String(r.legalName)} {r.invoicing === false ? <Badge tone="outline">{t("Cash only")}</Badge> : null} {inactive(r)}
            </span>
          ),
        },
        { label: "Address", render: (r) => (r.addressLines as string[]).join(", ") },
        { label: "Language", render: (r) => (r.defaultLang === "ZH" ? t("Chinese") : t("English")) },
      ],
    },
    {
      id: "bankAccount",
      label: "Bank accounts",
      icon: Landmark,
      description:
        "Every bank account. Invoice accounts can appear under Payment Details; balance-sheet accounts appear in the cash book. An account can be both.",
      rows: props.bankAccounts,
      columns: [
        { label: "Label", render: (r) => <span className="flex items-center gap-2">{String(r.label)} {r.compact ? <Badge tone="outline">{t("Compact")}</Badge> : null} {inactive(r)}</span> },
        { label: "Used for", render: (r) => <Badge tone={USE_TONE[String(r.use)] ?? "neutral"}>{t(USE_LABEL[String(r.use)] ?? String(r.use))}</Badge> },
        { label: "Company", render: (r) => (r.companyName ? String(r.companyName) : <span className="text-ink-soft">—</span>) },
        { label: "Currency", render: (r) => String(r.currency), mono: true },
        { label: "Account name", render: (r) => String(r.accountName) },
        { label: "Account number", render: (r) => String(r.accountNumber), mono: true },
        {
          label: "Bank",
          render: (r) => (
            <span>
              {String(r.bankName || "—")}
              {r.accountType ? <span className="block text-[12px] text-ink-soft">{String(r.accountType)}</span> : null}
            </span>
          ),
        },
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
        { label: "Company", render: (r) => (r.companyName ? String(r.companyName) : <span className="text-ink-soft">{t("Any")}</span>) },
        { label: "Currency", render: (r) => (r.currency ? String(r.currency) : <span className="text-ink-soft">{t("Any")}</span>), mono: true },
        { label: "Bank account", render: (r) => String(r.accountLabel) },
      ],
    },
    {
      id: "fxRate",
      label: "FX rates",
      icon: Coins,
      description:
        "Pulled from Yahoo Finance once a day and whenever someone refreshes the rate on an invoice. A rate typed here is used until the next pull. Each invoice can still override the booked USD.",
      rows: props.fx,
      columns: [
        { label: "Currency", render: (r) => String(r.currency), mono: true },
        { label: "Units per 1 USD", render: (r) => String(r.perUsd), mono: true, align: "right" },
        { label: "Source", render: (r) => (r.source === "YAHOO" ? <Badge tone="brand">Yahoo Finance</Badge> : <Badge tone="outline">{t("Manual")}</Badge>) },
        { label: "Updated", render: (r) => formatDateTime(String(r.updatedAt)), align: "right" },
      ],
    },
    {
      id: "owner",
      label: "Owners",
      icon: UserRound,
      description: "Account owners assigned to clients and invoices. New invoices use the client's default owner, or the default owner here when the client has none.",
      rows: props.owners,
      columns: [
        {
          label: "Name",
          render: (r) => (
            <span className="flex items-center gap-2">
              {String(r.name)} {r.isDefault ? <Badge tone="brand">{t("Default")}</Badge> : null} {inactive(r)}
            </span>
          ),
        },
      ],
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
      description:
        "Line items for manual invoices, with the English and Chinese label printed for each language. The ledger type and subtype fill in the invoice's type when the item is its first line.",
      rows: props.items,
      columns: [
        { label: "English", render: (r) => <span className="flex items-center gap-2">{String(r.labelEn)} {inactive(r)}</span> },
        { label: "Chinese", render: (r) => (r.labelZh ? String(r.labelZh) : <span className="text-ink-soft">{t("Uses English")}</span>) },
        {
          label: "Ledger type",
          render: (r) =>
            r.typeId ? (
              <span>
                {typeName.get(String(r.typeId)) ?? "—"}
                {r.subtype ? <span className="text-ink-soft"> · {String(r.subtype)}</span> : null}
              </span>
            ) : (
              <span className="text-ink-soft">—</span>
            ),
        },
        { label: "Detail hint", render: (r) => (r.detailHint ? String(r.detailHint) : "—") },
        { label: "Client fee", render: (r) => (r.clientFee ? String(r.clientFee) : "—"), mono: true },
      ],
    },
    {
      id: "cashCategory",
      label: "Cash categories",
      icon: FolderTree,
      description:
        "Categories for cash book lines (the 摘要 column). Income and expense make up the monthly statement; transfers move money between accounts and are shown separately.",
      rows: props.cashCategories,
      columns: [
        { label: "Chinese", render: (r) => <span className="flex items-center gap-2">{String(r.nameZh)} {inactive(r)}</span> },
        { label: "English", render: (r) => (r.nameEn ? String(r.nameEn) : <span className="text-ink-soft">—</span>) },
        { label: "Kind", render: (r) => <Badge tone={KIND_TONE[String(r.kind)] ?? "neutral"}>{t(KIND_LABEL[String(r.kind)] ?? String(r.kind))}</Badge> },
      ],
    },
  ];

  const tab = tabs.find((x) => x.id === tabId)!;
  const config = !editing
    ? null
    : editing.entity === "user"
      ? { title: "User", fields: userFields(t, !editing.row ? "invite" : editing.row.pending ? "pending" : "edit") }
      : SETTINGS_ENTITIES[editing.entity];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">
        {tabs.map((x) => {
          const Icon = x.icon;
          return (
            <button
              key={x.id}
              onClick={() => setTabId(x.id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors",
                x.id === tabId
                  ? "bg-brand-500/10 text-brand-700 shadow-[inset_0_0_0_1px_rgb(var(--brand-500)/0.2)] dark:text-brand-200 dark:shadow-[inset_0_0_0_1px_rgb(var(--brand-500)/0.25)]"
                  : "text-ink-muted hover:bg-overlay/[0.05] hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(x.label)}
              <span className="ml-auto font-mono text-[11px] text-ink-soft">{x.rows.length}</span>
            </button>
          );
        })}
      </nav>

      <section className="glass-panel neon-edge rounded-card">
        {issued && (
          <div className="flex items-start gap-3 border-b border-line bg-brand-500/10 px-5 py-3.5">
            {issued.kind === "invite" ? (
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
            ) : (
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" />
            )}
            {issued.kind === "invite" ? (
              <div className="min-w-0 flex-1 text-[13px] text-ink">
                {issued.emailed === "sent"
                  ? t("Invitation sent to {0}.", issued.email)
                  : issued.emailed === "logged"
                    ? t("Invitation created for {0}. Email isn't set up on this server, so nothing was sent.", issued.email)
                    : t("Invitation created for {0}, but the email could not be sent.", issued.email)}
                <p className="mt-1 text-ink-muted">
                  {t("You can also copy the link and send it yourself. It is valid for 72 hours and works once.")}
                </p>
                <CopyLinkButton link={issued.link} />
              </div>
            ) : (
              <div className="min-w-0 flex-1 text-[13px] text-ink">
                {t("Password for {0}:", issued.email)}{" "}
                <code className="select-all rounded bg-overlay/10 px-1.5 py-0.5 font-mono text-[13px] text-brand-700 dark:text-brand-200">{issued.password}</code>
                <p className="mt-1 text-ink-muted">
                  {t("Copy it now; it won't be shown again. They can change it under My account after signing in.")}
                </p>
              </div>
            )}
            <button
              onClick={() => setIssued(null)}
              aria-label={t("Dismiss")}
              className="flex h-7 w-7 items-center justify-center rounded-control text-ink-soft hover:bg-overlay/[0.06] hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{t(tab.label)}</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] text-ink-muted">{t(tab.description)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tab.id === "fxRate" && <RefreshFxButton />}
            <Button size="sm" onClick={() => setEditing({ entity: tab.id, row: null })}>
              {tab.id === "user" ? <UserPlus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {tab.id === "user" ? t("Invite user") : t("Add")}
            </Button>
          </div>
        </div>
        <div className="relative overflow-x-auto px-5 pb-2">
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
                    {t(c.label)}
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
                    {t("Nothing here yet.")}
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
          title={editing.entity === "user" && !editing.row ? t("Invite user") : t(editing.row ? "Edit {0}" : "Add {0}", t(config.title).toLowerCase())}
          saveLabel={editing.entity === "user" && !editing.row ? "Send invitation" : "Save"}
          fields={config.fields as FieldDef[]}
          initial={editing.row ?? (editing.entity === "user" ? INVITE_DEFAULTS : null)}
          options={options}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            if (editing.entity === "user") {
              const email = String(values.email).trim().toLowerCase();
              if (!editing.row) {
                const res = await inviteUser(values);
                if (!res.ok) return res.error;
                setIssued({ kind: "invite", email, link: res.link, emailed: res.emailed });
                router.refresh();
                return null;
              }
              const res = await saveUser(editing.row.id, values);
              if (!res.ok) return res.error;
              if (res.password) setIssued({ kind: "password", email, password: res.password });
              if (editing.row.pending && values.resendInvite && values.active) {
                const sent = await resendInvite(editing.row.id);
                if (!sent.ok) return sent.error;
                setIssued({ kind: "invite", email, link: sent.link, emailed: sent.emailed });
              }
              router.refresh();
              return null;
            }
            const res = await saveSetting(editing.entity, editing.entity === "fxRate" ? null : editing.row?.id ?? null, values);
            if (!res.ok) return res.error;
            router.refresh();
            return null;
          }}
          onDelete={
            editing.row && editing.entity !== "user"
              ? async () => {
                  const res = await deleteSetting(editing.entity as SettingsEntity, editing.row!.id);
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

function formatDateTime(iso: string) {
  return `${formatDate(iso)} ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function CopyLinkButton({ link }: { link: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={copy}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? t("Copied") : t("Copy invite link")}
      </Button>
      {failed && (
        <code className="max-w-full select-all break-all rounded bg-overlay/10 px-1.5 py-0.5 font-mono text-[12px] text-brand-700 dark:text-brand-200">
          {link}
        </code>
      )}
    </div>
  );
}

function RefreshFxButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      {error && <span className="text-[12px] text-rose-600 dark:text-rose-300">{t(error)}</span>}
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await refreshRates();
            if (!res.ok) return setError(res.error);
            router.refresh();
          })
        }
      >
        {!pending && <RefreshCw className="h-4 w-4" />}
        {t("Refresh from Yahoo Finance")}
      </Button>
    </>
  );
}
