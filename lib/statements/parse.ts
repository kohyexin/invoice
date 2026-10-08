import { isAirwallex, parseAirwallex } from "./airwallex";
import { isAnext, parseAnext } from "./anext";
import { isCib, parseCib } from "./cib";
import type { ParsedStatement } from "./types";

const isSpreadsheet = (bytes: Uint8Array, name: string) =>
  /\.xlsx?$/i.test(name) ||
  (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) ||
  (bytes[0] === 0x50 && bytes[1] === 0x4b);

const isCsv = (bytes: Uint8Array, name: string) => /\.csv$/i.test(name) || /^\uFEFF?"?Time"?,/.test(new TextDecoder().decode(bytes.subarray(0, 64)));

/** Reads a bank statement: ANEXT PDFs, Industrial Bank (XMXY) Excel downloads and Airwallex CSV
 *  reports, the last two split into months. */
export async function parseStatement(data: ArrayBuffer | Uint8Array, name = ""): Promise<ParsedStatement[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isCsv(bytes, name)) {
    const XLSX = await import("xlsx");
    // Decoded here so Chinese payer names survive; SheetJS would guess the code page.
    const wb = XLSX.read(new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, ""), { type: "string", raw: true });
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    if (isAirwallex(rows)) return parseAirwallex(rows);
    throw new Error("This CSV isn't a supported bank download. Only Airwallex Balance Activity Reports can be imported.");
  }
  if (isSpreadsheet(bytes, name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "array" });
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: "" });
      if (isCib(rows)) return parseCib(rows);
    }
    throw new Error("This spreadsheet isn't a supported bank download. Only Industrial Bank (XMXY) Excel files can be imported.");
  }

  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  if (isAnext(pages.join("\n"))) return [parseAnext(pages)];
  throw new Error("This bank's statements aren't supported yet. ANEXT PDFs, Industrial Bank (XMXY) Excel downloads and Airwallex CSV reports can be imported.");
}
