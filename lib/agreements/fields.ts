/* Agreement template fields: one per AcroForm field in the blank PDF, with how
 * it is asked for on the New agreement form and which client detail it fills.
 * Shared by server and client, so no server imports here. */

import { FIELD_BY_HEADER, normalizeHeader } from "@/lib/client-import";

export type FieldType = "text" | "multiline" | "date" | "number" | "checkbox" | "choice" | "signature";

export type FieldConfig = {
  pdfFieldName: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** A Client field (see CLIENT_KEYS), or "fees:<HEADER>" for the fee schedule. Empty: agreement only. */
  clientKey: string;
  /** Options for dropdowns and radio groups. */
  options?: string[];
  /** Not shown on the form (e.g. a field the PDF fills itself). */
  hidden?: boolean;
  /** Starting value on the New agreement form: a fixed value, "today" for dates,
   *  or a formula such as "SPC-{DDMMYYYY}" (see resolveDefault). */
  default?: string;
  /** Who signs a signature field (see SIGNER_ROLES). */
  signerRole?: SignerRole;
};

/** The parties that sign an agreement. Each gets their own emailed link. */
export const SIGNER_ROLES = [
  { key: "client", label: "Client" },
  { key: "company", label: "Company (STAR SAAS)" },
] as const;

export type SignerRole = (typeof SIGNER_ROLES)[number]["key"];

export const signerRoleLabel = (key: string) => SIGNER_ROLES.find((r) => r.key === key)?.label ?? key;

/** The signer roles a template's signature fields use, in SIGNER_ROLES order. */
export function templateSignerRoles(fields: FieldConfig[]): SignerRole[] {
  const used = new Set(fields.filter((f) => f.type === "signature" && f.signerRole).map((f) => f.signerRole));
  return SIGNER_ROLES.map((r) => r.key).filter((k) => used.has(k));
}

/** A field's box on the page, in PDF points from the bottom-left corner. Page is 0-based. */
export type FieldBox = { pdfFieldName: string; page: number; x: number; y: number; width: number; height: number };

/** A PDF field name for a newly placed field: its label, numbered when taken.
 *  Periods would nest the field in PDF forms, so they are left out. */
export function newFieldName(label: string, taken: Set<string>) {
  const base = label.replace(/\./g, "").replace(/\s+/g, " ").trim() || "Field";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Client details a PDF field can fill, in the order of the client form. */
export const CLIENT_KEYS = [
  { key: "name", label: "Client name" },
  { key: "agreementNo", label: "Agreement no." },
  { key: "agreementDate", label: "Agreement date" },
  { key: "country", label: "Country" },
  { key: "incorporationNo", label: "Incorporation no." },
  { key: "address", label: "Address (all lines)" },
  { key: "address1", label: "Address line 1" },
  { key: "address2", label: "Address line 2" },
  { key: "address3", label: "Address line 3" },
  { key: "city", label: "City" },
  { key: "directorName", label: "Director name" },
  { key: "contactTitle", label: "Contact title" },
  { key: "contactEmail", label: "Contact email" },
  { key: "websiteUrls", label: "Website URLs" },
] as const;

export type ClientKey = (typeof CLIENT_KEYS)[number]["key"];

/** The client's address lines, which the combined "address" field fills together. */
export const ADDRESS_LINES = ["address1", "address2", "address3"] as const;

/** Address lines 1–3 as one block, a line each. */
export function joinAddress(lines: (string | null | undefined)[]) {
  return lines.map((l) => (l ?? "").trim()).filter(Boolean).join("\n");
}

/** A combined address back into lines 1–3; anything past the third line joins the third. */
export function splitAddress(text: string): [string, string, string] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return [lines[0] ?? "", lines[1] ?? "", lines.slice(2).join(", ")];
}

export const FEE_PREFIX = "fees:";

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "multiline", label: "Long text" },
  { value: "date", label: "Date" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "choice", label: "Choice" },
  { value: "signature", label: "Signature (signed later)" },
];

/** Fields the person creating the agreement fills in (signatures come with e-sign). */
export const isInput = (f: FieldConfig) => !f.hidden && f.type !== "signature";

export function parseFieldConfig(raw: unknown): FieldConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object" && typeof (f as { pdfFieldName?: unknown }).pdfFieldName === "string")
    .map((f) => ({
      pdfFieldName: String(f.pdfFieldName),
      label: String(f.label ?? f.pdfFieldName),
      type: (FIELD_TYPES.some((t) => t.value === f.type) ? f.type : "text") as FieldType,
      required: Boolean(f.required),
      clientKey: typeof f.clientKey === "string" ? f.clientKey : "",
      options: Array.isArray(f.options) ? f.options.map(String) : undefined,
      hidden: Boolean(f.hidden) || undefined,
      default: typeof f.default === "string" && f.default.trim() ? f.default.trim() : undefined,
      signerRole: f.type === "signature" && SIGNER_ROLES.some((r) => r.key === f.signerRole) ? (f.signerRole as SignerRole) : undefined,
    }));
}

export const TODAY = "today";

/** A default with {…} parts is worked out from other fields as the form is filled. */
export const isFormula = (d: string | undefined) => Boolean(d && /\{[^}]+\}/.test(d));

/** "DDMMYYYY" etc. applied to a yyyy-mm-dd date. */
function formatPattern(pattern: string, iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return pattern.replace(/YYYY|YY|MM|DD/g, (t) => ({ YYYY: y, YY: y.slice(2), MM: m, DD: d })[t] ?? t);
}

/** A field's default for the form. In a formula, {DDMMYYYY}-style parts (any mix
 *  of DD, MM, YY, YYYY and separators) print the agreement date, today when there
 *  is none; any other {…} prints the field with that label or PDF name. */
export function resolveDefault(field: FieldConfig, fields: FieldConfig[], values: Record<string, string>, today: string): string {
  const d = field.default ?? "";
  if (field.type === "date") return d === TODAY ? today : /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
  if (!isFormula(d)) return d;
  const dateField = fields.find((f) => f.clientKey === "agreementDate");
  const date = (dateField && values[dateField.pdfFieldName]) || today;
  return d.replace(/\{([^}]+)\}/g, (_, raw: string) => {
    const key = raw.trim();
    if (/^(DD|MM|YYYY|YY|[\s\-/.])+$/.test(key)) return formatPattern(key, date);
    const ref = fields.find((f) => f !== field && (f.label.toLowerCase() === key.toLowerCase() || f.pdfFieldName === key));
    return ref ? (values[ref.pdfFieldName] ?? "").trim() : "";
  });
}

/** "Client_Address_1" → "CLIENT ADDRESS 1". */
function headerOf(pdfFieldName: string) {
  return normalizeHeader(pdfFieldName.replace(/[_.\-[\]]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
}

/** Turns a PDF field name into a readable label, e.g. "client_address_1" → "Client address 1". */
export function labelOf(pdfFieldName: string) {
  const h = headerOf(pdfFieldName).toLowerCase();
  return h ? h[0].toUpperCase() + h.slice(1) : pdfFieldName;
}

const KEY_BY_HEADER: Record<string, string> = {
  ...Object.fromEntries(Object.entries(FIELD_BY_HEADER).filter(([, k]) => CLIENT_KEYS.some((c) => c.key === k))),
  ...Object.fromEntries(CLIENT_KEYS.map((c) => [normalizeHeader(c.label), c.key])),
  ...Object.fromEntries(CLIENT_KEYS.map((c) => [headerOf(c.key), c.key])),
};

/** Best guess for a new field: the client field its name matches (Jotform's
 *  column names), a fee when it mentions one, else agreement only. */
export function guessClientKey(pdfFieldName: string): string {
  const h = headerOf(pdfFieldName);
  if (KEY_BY_HEADER[h]) return KEY_BY_HEADER[h];
  if (/\bFEES?\b/.test(h)) return `${FEE_PREFIX}${h}`;
  return "";
}

/** A client as the New agreement form sees it: dates as yyyy-mm-dd. */
export type ClientDetails = Record<ClientKey, string> & { id: string; fees: Record<string, string> };

/** Form values from an existing client, for every field mapped to one of its
 *  details. The agreement number and date belong to the new agreement, so they start blank. */
export function prefillFromClient(fields: FieldConfig[], client: ClientDetails): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!isInput(f) || !f.clientKey || f.type === "checkbox" || f.clientKey === "agreementNo" || f.clientKey === "agreementDate") continue;
    const v = f.clientKey.startsWith(FEE_PREFIX) ? client.fees[f.clientKey.slice(FEE_PREFIX.length)] : client[f.clientKey as ClientKey];
    if (v) out[f.pdfFieldName] = v;
  }
  return out;
}

export function clientKeyLabel(key: string) {
  if (!key) return "";
  if (key.startsWith(FEE_PREFIX)) return `Fee: ${key.slice(FEE_PREFIX.length)}`;
  return CLIENT_KEYS.find((c) => c.key === key)?.label ?? key;
}
