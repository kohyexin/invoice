import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { mergeCib, parseCib } from "@/lib/statements/cib";
import type { ParsedStatement } from "@/lib/statements/types";

/* Splits an Industrial Bank download into two ranges and checks that merging them gives
   the same months, balances and transactions as the whole file. A split that leaves a
   gap (second range starting after a missing transaction) must fail. No database access.

     npx tsx scripts/check-statement-overlap.ts <file.xls> <split-end yyyy-mm-dd> <split-start yyyy-mm-dd> */

type Row = (string | number)[];

const [file, endA, startB] = process.argv.slice(2);
if (!file || !endA || !startB) throw new Error("Usage: <file.xls> <first range ends> <second range starts>");

const wb = XLSX.read(readFileSync(file));
const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
const h = rows.findIndex((r) => r.includes("Unique Code"));
const head = rows[h];
const body = rows.slice(h + 1);
const date = head.indexOf("Posting Date");
const upTo = (d: string) => body.filter((r) => String(r[date]) <= d);
const from = (d: string) => body.filter((r) => String(r[date]) >= d);

const sig = (list: ParsedStatement[]) =>
  list
    .map((s) => {
      const sec = s.sections[0];
      return `${s.periodStart}..${s.periodEnd}${s.partial ? " partial" : ""} opening ${sec.opening} closing ${sec.closing} lines ${sec.entries.length} refs ${sec.entries.map((e) => e.ref).sort().join(",")}`;
    })
    .join("\n");

const whole = parseCib(rows);
const merged = mergeCib([...parseCib([head, ...upTo(endA)]), ...parseCib([head, ...from(startB)])]);
console.log(`whole file:\n${sig(whole).replace(/ refs .*/gm, "")}`);
console.log(`merged ${endA} / ${startB}:\n${sig(merged).replace(/ refs .*/gm, "")}`);
console.log(`identical: ${sig(whole) === sig(merged)}`);
