import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { clientKeyLabel } from "@/lib/agreements/fields";
import { discoverFields } from "@/lib/agreements/pdf";
import { prisma } from "@/lib/db";

/* Adds the PCI and PAAS agreement templates from their blank PDFs, with a first
 * guess at which client detail each existing field fills. Place or finish the
 * fields (labels, required, fees) in Agreements → Agreement templates.

     npx tsx --conditions=react-server scripts/seed-agreement-templates.ts                      show the fields found
     npx tsx --conditions=react-server scripts/seed-agreement-templates.ts --apply              add the templates
     npx tsx --conditions=react-server scripts/seed-agreement-templates.ts --pci=<pdf> --paas=<pdf>   other file paths

   Templates whose code already exists are left alone. */

const apply = process.argv.includes("--apply");
const actorName = "Script: seed-agreement-templates";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const TEMPLATES = [
  { code: "PCI", name: "PCI Agreement", path: arg("pci") ?? "docs/PCI Agreement (no renew).pdf" },
  { code: "PAAS", name: "PAAS Agreement", path: arg("paas") ?? "docs/2025_PAAS_Agreement.pdf" },
];

async function main() {
  const last = await prisma.agreementTemplate.aggregate({ _max: { sortOrder: true } });
  let sortOrder = last._max.sortOrder ?? 0;
  const toAdd = [];

  for (const t of TEMPLATES) {
    console.log(`\n${t.code}: ${t.path}`);
    if (await prisma.agreementTemplate.findUnique({ where: { code: t.code }, select: { id: true } })) {
      console.log("  Already exists, skipped.");
      continue;
    }
    if (!existsSync(t.path)) {
      console.log(`  File not found. Put the blank PDF there, or pass --${t.code.toLowerCase()}=<path>.`);
      continue;
    }
    const pdf = readFileSync(t.path);
    const fields = await discoverFields(new Uint8Array(pdf));
    for (const f of fields) console.log(`  ${f.pdfFieldName}  [${f.type}]  → ${clientKeyLabel(f.clientKey) || "agreement only"}`);
    if (fields.length === 0) console.log("  No fillable fields: place them in Agreement templates after adding.");
    toAdd.push({ ...t, pdf, fields, sortOrder: ++sortOrder });
  }

  if (toAdd.length === 0) return console.log("\nNothing to add.");
  if (!apply) return console.log(`\nDry run: would add ${toAdd.map((t) => t.code).join(", ")}. Add --apply to save.`);

  for (const t of toAdd) {
    const row = await prisma.agreementTemplate.create({
      data: { name: t.name, code: t.code, pdf: t.pdf, pdfFilename: basename(t.path), fieldConfig: t.fields, sortOrder: t.sortOrder },
    });
    await prisma.activityLog.create({
      data: {
        actorName,
        action: "create",
        entity: "agreement_template",
        entityId: row.id,
        label: t.name,
        changes: { code: [null, t.code], pdfFilename: [null, basename(t.path)], fields: [null, t.fields.length] },
      },
    });
    console.log(`Added ${t.code} (${t.fields.length} fields).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
