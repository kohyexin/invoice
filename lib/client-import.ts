/* Maps a Jotform / Client DB row (header → value) onto Client fields.
   Headers are matched case-insensitively; every other non-empty column that
   is not form metadata goes into the fee schedule. */

export type ClientDraft = {
  name: string;
  agreementNo: string;
  agreementDate: Date | null;
  country: string;
  incorporationNo: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  directorName: string;
  contactTitle: string;
  contactEmail: string;
  websiteUrls: string;
  jotformId: string | null;
  submittedAt: Date | null;
  fees: Record<string, string>;
};

export const FIELD_BY_HEADER: Record<string, keyof ClientDraft> = {
  "CLIENT NAME": "name",
  "AGREEMENT NO.": "agreementNo",
  "AGREEMENT NO": "agreementNo",
  "AGREEMENT DATE": "agreementDate",
  "CLIENT COUNTRY": "country",
  "INCORPORATION NO.": "incorporationNo",
  "INCORPORATION NO": "incorporationNo",
  "CLIENT ADDRESS 1": "address1",
  "CLIENT ADDRESS 2": "address2",
  "CLIENT ADDRESS 3": "address3",
  "CLIENT CITY": "city",
  "DIRECTOR NAME": "directorName",
  "CONTACT TITLE": "contactTitle",
  "CONTACT EMAIL": "contactEmail",
  "WEBSITE URLS": "websiteUrls",
  "SUBMISSION ID": "jotformId",
  "SUBMISSION DATE": "submittedAt",
};

/** Form metadata that is neither a client field nor a fee. */
const IGNORED = new Set([
  "UNIQUE ID",
  "SUBMITTED BY",
  "SUBMISSION IP",
  "LAST UPDATE DATE",
  "CLIENT ADD 2 & 3",
]);

/** A client's website URLs from however they were typed: separated by lines, commas, semicolons or spaces. */
export function splitUrls(text: string) {
  return text.split(/[\s,;]+/).map((u) => u.trim()).filter(Boolean);
}

/** Website URLs as the client stores them: one per line. */
export function joinUrls(urls: string[]) {
  return urls.map((u) => u.trim()).filter(Boolean).join("\n");
}

export function normalizeHeader(h: string) {
  return h.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Accepts Excel serial numbers, ISO strings and Jotform's "Sep 24, 2025". */
export function parseLooseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toUtcDate(value);
  if (typeof value === "number" || /^\d{5}(\.\d+)?$/.test(String(value))) {
    const serial = Number(value);
    return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  }
  const s = String(value).trim();
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toUtcDate(d);
}

function toUtcDate(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

export function toClientDraft(row: Record<string, unknown>): ClientDraft | null {
  const draft: ClientDraft = {
    name: "",
    agreementNo: "",
    agreementDate: null,
    country: "",
    incorporationNo: "",
    address1: "",
    address2: "",
    address3: "",
    city: "",
    directorName: "",
    contactTitle: "",
    contactEmail: "",
    websiteUrls: "",
    jotformId: null,
    submittedAt: null,
    fees: {},
  };

  for (const [rawHeader, value] of Object.entries(row)) {
    const header = normalizeHeader(rawHeader);
    if (!header || IGNORED.has(header)) continue;
    const field = FIELD_BY_HEADER[header];
    if (field === "agreementDate" || field === "submittedAt") {
      draft[field] = parseLooseDate(value);
    } else if (field === "jotformId") {
      draft.jotformId = text(value) || null;
    } else if (field) {
      (draft[field] as string) = text(value);
    } else {
      const v = text(value);
      if (v) draft.fees[header] = v;
    }
  }

  return draft.name ? draft : null;
}

export function nameKey(name: string) {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Upper-cased, trimmed and de-duplicated agreement numbers. */
export function normalizeAgreements(list: string[]) {
  return [...new Set(list.map((a) => a.trim().toUpperCase()).filter(Boolean))];
}

type ExistingClient = {
  agreementNo: string;
  agreementDate: Date | null;
  country: string;
  incorporationNo: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  directorName: string;
  contactTitle: string;
  contactEmail: string;
  websiteUrls: string;
  otherAgreements: string[];
  jotformId: string | null;
  submittedAt: Date | null;
  fees: unknown;
};

const TEXT_FIELDS = [
  "country",
  "incorporationNo",
  "address1",
  "address2",
  "address3",
  "city",
  "directorName",
  "contactTitle",
  "contactEmail",
  "websiteUrls",
] as const;

/** Update for an existing client from a form row. Text already on the client
 *  is kept (only blanks are filled) and fees are merged, never removed. When
 *  the form is a different agreement than the client's (e.g. a PCI form for a
 *  Whitelabel client), the client's agreement stays and the form's is added to
 *  its other agreements. */
export function mergeClientDraft(existing: ExistingClient, d: ClientDraft, jotformIdFree: boolean) {
  const data: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) {
    if (!existing[f].trim() && d[f]) data[f] = d[f];
  }

  const fees: Record<string, string> = { ...((existing.fees as Record<string, string>) ?? {}), ...d.fees };
  const otherAgreement = !!existing.agreementNo.trim() && !!d.agreementNo && nameKey(existing.agreementNo) !== nameKey(d.agreementNo);
  if (otherAgreement) {
    data.otherAgreements = normalizeAgreements([...existing.otherAgreements, d.agreementNo]);
  } else {
    if (d.agreementNo && !existing.agreementNo.trim()) data.agreementNo = d.agreementNo;
    if (d.agreementDate) data.agreementDate = d.agreementDate;
    if (d.submittedAt) data.submittedAt = d.submittedAt;
    if (d.jotformId && !existing.jotformId && jotformIdFree) data.jotformId = d.jotformId;
  }
  data.fees = fees;
  return data;
}

/** Client fields written on import. Alias, owner, transfer name and notes
 *  are ours and are never overwritten by a form resubmission. */
export function clientData(d: ClientDraft) {
  return {
    agreementNo: d.agreementNo,
    agreementDate: d.agreementDate,
    country: d.country,
    incorporationNo: d.incorporationNo,
    address1: d.address1,
    address2: d.address2,
    address3: d.address3,
    city: d.city,
    directorName: d.directorName,
    contactTitle: d.contactTitle,
    contactEmail: d.contactEmail,
    websiteUrls: d.websiteUrls,
    submittedAt: d.submittedAt,
    fees: d.fees,
  };
}
