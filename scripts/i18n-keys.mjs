// Lists English UI strings that have no entry in lib/i18n-zh.ts.
// Usage: node scripts/i18n-keys.mjs [--all]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components", "lib"];
const SKIP = /generated|i18n-zh\.ts|pdf[\\/]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const keys = new Set();
const add = (s) => {
  s = s.trim().replace(/ \*$/, ""); // Field translates required labels without the marker
  if (s.length < 2) return;
  if (!/[A-Za-z]/.test(s)) return;
  if (/^[a-z0-9_./@:#-]+$/.test(s) && !/\s/.test(s)) return; // identifiers, paths, classes
  if (/^[A-Z0-9_]+$/.test(s) && s.includes("_")) return; // ENV_NAMES
  if (/^(use client|use server|server-only)$/.test(s)) return;
  if (/\b(flex|grid|rounded|text-|bg-|px-|py-|h-\d|w-\d|border|items-|justify-|gap-)/.test(s)) return;
  if (/^(GET|POST|PUT|DELETE|PATCH)$/.test(s)) return;
  keys.add(s);
};

const templ = (s) => {
  let i = 0;
  return s.replace(/\$\{[^}]*\}/g, () => `{${i++}}`);
};

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const src = readFileSync(file, "utf8");
  if (file.includes("api") && !/error/.test(src)) continue;
  // t("..."), including ternaries inside t(...)
  for (const m of src.matchAll(/\bt\(\s*([^;]*?)\)/g)) {
    for (const s of m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) add(s[1]);
  }
  // JSX string props and object fields that shared components translate
  for (const m of src.matchAll(/\b(label|title|subtitle|hint|breadcrumb|header|description|placeholder|tagline|help|error|reason|footer)\s*[=:]\s*"((?:[^"\\]|\\.)*)"/g)) add(m[2]);
  for (const m of src.matchAll(/\b(label|title|subtitle|error|reason|hint|description)\s*[=:]\s*\{?`((?:[^`\\]|\\.)*)`/g)) add(templ(m[2]));
  for (const m of src.matchAll(/\b(error|reason)\s*:\s*`((?:[^`\\]|\\.)*)`/g)) add(templ(m[2]));
  // Plain JSX text between tags on one line
  for (const m of src.matchAll(/>\s*([A-Z][^<>{}\n]*[a-z.?!)])\s*</g)) add(m[1]);
  // Status/role style arrays and returned messages
  for (const m of src.matchAll(/return\s+"([^"]{3,})"/g)) add(m[1]);
  for (const m of src.matchAll(/new Error\("([^"]+)"\)/g)) add(m[1]);
}

const zhSrc = readFileSync("lib/i18n-zh.ts", "utf8");
const have = new Set([
  ...[...zhSrc.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)].map((m) => JSON.parse(`"${m[1]}"`)),
  ...[...zhSrc.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]),
]);
const all = process.argv.includes("--all");
const list = [...keys].filter((k) => all || !have.has(k)).sort((a, b) => a.localeCompare(b));
console.log(JSON.stringify(list, null, 1));
console.error(`${list.length} ${all ? "keys" : "missing"} (dictionary has ${have.size})`);
