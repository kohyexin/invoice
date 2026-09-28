/* Reads the fields the ledger needs from a STAR SAAS billing-system invoice
   (the PDF emailed on the 1st, e.g. "Invoice on Circlepayment / 01-Sep-2026"). */

export type SystemInvoice = {
  number: string;
  reference: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string;
  amount: number;
};

const MON: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "01-Sep-2026" → "2026-09-01" */
function isoDate(s: string | undefined) {
  const m = s?.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const mm = MON[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, "0")}` : null;
}

const money = (s: string) => Number(s.replace(/[^\d.-]/g, ""));

export function parseSystemInvoiceText(raw: string): { ok: true; invoice: SystemInvoice } | { ok: false; error: string; partial: Partial<SystemInvoice> } {
  const text = raw.replace(/\r/g, "").replace(/[ \t\u00a0]+/g, " ");

  const number = text.match(/\b(SI\d{6,})\b/)?.[1] ?? "";
  const reference = text.match(/\b([A-Z]{2,5}-\d{6,})\b/)?.[1] ?? "";
  const clientName = text.match(/Client Name:\s*([^\n]+?)\s*(?:\n|Category|$)/i)?.[1]?.trim() ?? "";
  const currency = text.match(/Amount Due \(([A-Z]{3})\)/i)?.[1]?.toUpperCase() ?? text.match(/GRAND TOTAL\s*\(([A-Z]{3})\)/i)?.[1]?.toUpperCase() ?? "USD";

  const grand = text.match(/GRAN[DT] TOTAL\s*\([A-Z]{3}\)\s*\$?\s*([\d,]+\.\d{2})/i)?.[1];
  const afterNumber = number ? text.slice(text.indexOf(number) + number.length).match(/^\s*\$?\s*([\d,]+\.\d{2})/)?.[1] : undefined;
  const amountText = grand ?? afterNumber;

  const period = text.match(/billing period from\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+to\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
  // Issue date sits on the same row as the invoice number; due date follows "Due Date".
  const issue = number ? text.slice(0, text.indexOf(number)).match(/(\d{1,2}-[A-Za-z]{3}-\d{4})\s*$/)?.[1] : undefined;
  const dates = [...text.matchAll(/\b\d{1,2}-[A-Za-z]{3}-\d{4}\b/g)].map((m) => m[0]);
  const periodDates = new Set(period ? [period[1], period[2]] : []);
  const loose = dates.filter((d) => !periodDates.has(d));
  const due = text.match(/Due Date[\s\S]{0,40}?(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] ?? loose[1];

  const partial: Partial<SystemInvoice> = {
    number,
    reference,
    clientName,
    currency,
    invoiceDate: isoDate(issue ?? loose[0]) ?? undefined,
    dueDate: isoDate(due),
    periodFrom: isoDate(period?.[1]),
    periodTo: isoDate(period?.[2]),
    amount: amountText ? money(amountText) : undefined,
  };

  const missing = [!number && "invoice number", !partial.invoiceDate && "issue date", partial.amount === undefined && "amount"].filter(Boolean);
  if (missing.length) return { ok: false, error: `Could not read ${missing.join(", ")} from the PDF.`, partial };
  return { ok: true, invoice: partial as SystemInvoice };
}

export async function extractPdfText(data: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
