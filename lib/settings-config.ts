/* Editable settings tables. Shared by the settings UI (form fields) and the
   server action (which fields may be written, and how to coerce them). */

export type FieldKind = "text" | "lines" | "select" | "checkbox" | "number";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  /** Static options; dynamic ones (companies, accounts) are supplied by the UI. */
  options?: { value: string; label: string }[];
  /** Name of a dynamic option list the UI fills in. */
  optionsFrom?: "companies" | "bankAccounts" | "types";
  /** Empty select means null (e.g. "any company"). */
  nullable?: boolean;
  /** Label of the empty choice on a nullable select; defaults to "Any". */
  emptyLabel?: string;
  mono?: boolean;
};

export const CURRENCY_OPTIONS = ["USD", "HKD", "CNY", "EUR", "SGD"].map((c) => ({ value: c, label: c }));
/** Bank accounts and FX rates also take CNH, which only balance-sheet accounts use. */
export const ACCOUNT_CURRENCY_OPTIONS = [...CURRENCY_OPTIONS, { value: "CNH", label: "CNH" }];

export const ACCOUNT_USE_OPTIONS = [
  { value: "INVOICE", label: "Invoice only" },
  { value: "BALANCE", label: "Balance sheet only" },
  { value: "BOTH", label: "Invoice and balance sheet" },
];

export const CASH_KIND_OPTIONS = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "TRANSFER", label: "Transfer (not profit)" },
];

export const SETTINGS_ENTITIES = {
  company: {
    title: "Company",
    fields: [
      { key: "code", label: "Code", kind: "text", required: true, mono: true, hint: "Short id, e.g. STAR" },
      { key: "legalName", label: "Legal name", kind: "text", required: true },
      { key: "addressLines", label: "Address", kind: "lines", hint: "One line per row, as printed on the letterhead" },
      { key: "logoPath", label: "Logo path", kind: "text", hint: "File in public/logos, e.g. /logos/star.png" },
      {
        key: "defaultLang",
        label: "Default language",
        kind: "select",
        options: [
          { value: "EN", label: "English" },
          { value: "ZH", label: "Chinese" },
        ],
      },
      { key: "termsEn", label: "Terms (English)", kind: "lines" },
      { key: "termsZh", label: "Terms (Chinese)", kind: "lines" },
      { key: "invoicing", label: "Issues invoices (shown on the letterhead picker)", kind: "checkbox" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  bankAccount: {
    title: "Bank account",
    fields: [
      { key: "label", label: "Label", kind: "text", required: true, hint: "Shown in pickers, e.g. USD (SCB Bank)" },
      { key: "currency", label: "Currency", kind: "select", options: ACCOUNT_CURRENCY_OPTIONS, required: true, hint: "CNH is for balance-sheet accounts only" },
      {
        key: "use",
        label: "Used for",
        kind: "select",
        options: ACCOUNT_USE_OPTIONS,
        required: true,
        hint: "Invoice accounts can be printed under Payment Details; balance-sheet accounts appear in the cash book",
      },
      { key: "companyId", label: "Company", kind: "select", optionsFrom: "companies", nullable: true, emptyLabel: "None", hint: "Whose cash this is, for the balance sheet" },
      { key: "accountName", label: "Account name", kind: "text", required: true },
      { key: "accountNumber", label: "Account number", kind: "text", required: true, mono: true },
      { key: "bankName", label: "Bank name", kind: "text" },
      { key: "bankAddress", label: "Bank address", kind: "text" },
      { key: "bankCode", label: "Bank code", kind: "text", mono: true },
      { key: "branchCode", label: "Branch code", kind: "text", mono: true },
      { key: "swiftCode", label: "SWIFT code", kind: "text", mono: true },
      { key: "accountLocation", label: "Account location", kind: "text" },
      { key: "compact", label: "Compact (print name and number only)", kind: "checkbox" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  paymentRule: {
    title: "Payment default",
    fields: [
      { key: "companyId", label: "Company", kind: "select", optionsFrom: "companies", nullable: true, hint: "Leave empty for any company" },
      { key: "currency", label: "Currency", kind: "select", options: CURRENCY_OPTIONS, nullable: true, hint: "Leave empty for any currency" },
      { key: "bankAccountId", label: "Bank account", kind: "select", optionsFrom: "bankAccounts", required: true },
    ],
  },
  fxRate: {
    title: "FX rate",
    fields: [
      { key: "currency", label: "Currency", kind: "select", options: ACCOUNT_CURRENCY_OPTIONS.filter((c) => c.value !== "USD"), required: true },
      { key: "perUsd", label: "Units per 1 USD", kind: "number", required: true, hint: "e.g. 7.8 for HKD, 6.7 for CNY" },
    ],
  },
  cashCategory: {
    title: "Cash category",
    fields: [
      { key: "nameZh", label: "Chinese name", kind: "text", required: true, hint: "As written in the 摘要 column, e.g. 办公费用" },
      { key: "nameEn", label: "English name", kind: "text" },
      { key: "kind", label: "Kind", kind: "select", options: CASH_KIND_OPTIONS, required: true, hint: "Transfers move cash between accounts and are left out of income and expense" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  owner: {
    title: "Owner",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "isDefault", label: "Default owner (used when the client has none)", kind: "checkbox" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  invoiceType: {
    title: "Invoice type",
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "subtypeHint", label: "Subtype hint", kind: "text", hint: "What the subtype should say, e.g. Acquirer name" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
  invoiceItem: {
    title: "Invoice item",
    fields: [
      { key: "labelEn", label: "English label", kind: "text", required: true },
      { key: "labelZh", label: "Chinese label", kind: "text", hint: "Blank prints the English label" },
      { key: "detailHint", label: "Detail line hint", kind: "text", hint: "e.g. Month : or Channel :" },
      { key: "clientFee", label: "Client fee field", kind: "text", mono: true, hint: "Client DB column that prices this item, e.g. MAINTENANCE FEE" },
      { key: "typeId", label: "Ledger type", kind: "select", optionsFrom: "types", nullable: true, emptyLabel: "None", hint: "Filled in as the invoice type when this is the first line" },
      { key: "subtype", label: "Ledger subtype", kind: "text", hint: "e.g. Monthly. {month} becomes the invoice month (SEPT 2026); {detail} the line detail after its label (Channel : Alipay gives Alipay)" },
      { key: "sortOrder", label: "Sort order", kind: "number" },
      { key: "active", label: "Active", kind: "checkbox" },
    ],
  },
} satisfies Record<string, { title: string; fields: FieldDef[] }>;

export type SettingsEntity = keyof typeof SETTINGS_ENTITIES;
