import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseAirwallex } from "@/lib/statements/airwallex";
import { parseCib } from "@/lib/statements/cib";
import { mergeMonths } from "@/lib/statements/months";
import type { ParsedStatement } from "@/lib/statements/types";

/* Splits a date-range download (Industrial Bank .xls or Airwallex .csv) into two ranges and
   checks that merging them gives the same months, balances and transactions as the whole
   file. A split that leaves a gap (second range starting after a missing transaction) must
   fail. No database access.

     npx tsx scripts/check-statement-overlap.ts <file> <split-end yyyy-mm-dd> <split-start yyyy-mm-dd> */

type Row = (string | number)[];

const [file, endA, startB] = process.argv.slice(2);
if (!file || !endA || !startB) throw new Error("Usage: <file> <first range ends> <second range starts>");

const csv = /\.csv$/i.test(file);
const wb = csv ? XLSX.read(readFileSync(file, "utf8"), { type: "string", raw: true }) : XLSX.read(readFileSync(file));
const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
const h = csv ? 0 : rows.findIndex((r) => r.includes("Unique Code"));
const head = rows[h];
const body = rows.slice(h + 1);
const date = head.indexOf(csv ? "Time" : "Posting Date");
const day = (r: Row) => String(r[date]).slice(0, 10);
const upTo = (d: string) => body.filter((r) => day(r) <= d);
const from = (d: string) => body.filter((r) => day(r) >= d);
const parse = (list: Row[]) => (csv ? parseAirwallex(list) : parseCib(list));

const sig = (list: ParsedStatement[]) =>
  list
    .map((s) => {
      const sec = s.sections[0];
      return `${sec.currency} ${s.periodStart}..${s.periodEnd}${s.partial ? " partial" : ""} opening ${sec.opening} closing ${sec.closing} lines ${sec.entries.length} refs ${sec.entries.map((e) => e.ref).sort().join(",")}`;
    })
    .sort()
    .join("\n");

const whole = parse(rows);
const merged = mergeMonths([...parse([head, ...upTo(endA)]), ...parse([head, ...from(startB)])]);
console.log(`whole file:\n${sig(whole).replace(/ refs .*/gm, "")}`);
console.log(`merged ${endA} / ${startB}:\n${sig(merged).replace(/ refs .*/gm, "")}`);
console.log(`identical: ${sig(whole) === sig(merged)}`);
