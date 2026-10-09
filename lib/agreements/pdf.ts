import "server-only";
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFFont, PDFOptionList, PDFRadioGroup, PDFSignature, PDFTextField, StandardFonts } from "pdf-lib";
import { splitUrls } from "@/lib/client-import";
import { formatDate } from "@/lib/utils";
import { guessClientKey, joinAddress, labelOf, type FieldBox, type FieldConfig } from "./fields";

/* Agreement PDFs are blank templates with AcroForm fields: discover reads
 * them, fill writes the entered values in. */

/** The fillable fields of a blank template, with a first guess at each one's
 *  setup. A flat PDF has none; they are then placed in the field editor. */
export async function discoverFields(pdf: Uint8Array): Promise<FieldConfig[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  return doc.getForm().getFields().map((f) => {
    const name = f.getName();
    const base = { pdfFieldName: name, label: labelOf(name), required: false, clientKey: guessClientKey(name) };
    if (f instanceof PDFCheckBox) return { ...base, type: "checkbox" as const };
    if (f instanceof PDFSignature) return { ...base, type: "signature" as const, clientKey: "" };
    if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) {
      return { ...base, type: "choice" as const, options: f.getOptions() };
    }
    if (f instanceof PDFTextField) {
      const date = /date/i.test(name);
      return { ...base, type: date ? ("date" as const) : f.isMultiline() ? ("multiline" as const) : ("text" as const) };
    }
    return { ...base, type: "text" as const };
  });
}

/** Where each field sits, in PDF points: one box per place it appears. Radio
 *  groups (one box per option) are left out. */
export async function fieldBoxes(pdf: Uint8Array): Promise<FieldBox[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pages = doc.getPages();
  const out: FieldBox[] = [];
  for (const f of doc.getForm().getFields()) {
    if (f instanceof PDFRadioGroup) continue;
    for (const w of f.acroField.getWidgets()) {
      const ref = doc.context.getObjectRef(w.dict);
      const page = pages.findIndex((p) => p.node.Annots()?.asArray().some((a) => a === ref || doc.context.lookup(a) === w.dict));
      if (page < 0) continue;
      const r = w.getRectangle();
      out.push({ pdfFieldName: f.getName(), page, x: r.x, y: r.y, width: r.width, height: r.height });
    }
  }
  return out;
}

/** Writes the field editor's layout into the PDF: fields no longer in `fields`
 *  are removed, and every placed field is (re)created with a box for each place
 *  it appears (all showing the same value), without border or background so
 *  the printed lines show through. */
export async function applyLayout(pdf: Uint8Array, fields: FieldConfig[], boxes: FieldBox[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const form = doc.getForm();
  const pages = doc.getPages();
  const keep = new Set(fields.map((f) => f.pdfFieldName));
  const placed = new Set(boxes.map((b) => b.pdfFieldName));
  for (const f of [...form.getFields()]) {
    if (!keep.has(f.getName()) || placed.has(f.getName())) form.removeField(f);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const cfg of fields) {
    const own = boxes.filter((b) => b.pdfFieldName === cfg.pdfFieldName && pages[b.page]);
    if (own.length === 0) continue;
    const at = (b: FieldBox) => ({ x: b.x, y: b.y, width: b.width, height: b.height, borderWidth: 0, backgroundColor: undefined, borderColor: undefined });
    if (cfg.type === "checkbox") {
      const c = form.createCheckBox(cfg.pdfFieldName);
      for (const b of own) c.addToPage(pages[b.page], at(b));
    } else if (cfg.type === "choice") {
      const d = form.createDropdown(cfg.pdfFieldName);
      d.addOptions(cfg.options?.length ? cfg.options : [""]);
      for (const b of own) d.addToPage(pages[b.page], { ...at(b), font });
      d.setFontSize(10);
    } else {
      const t = form.createTextField(cfg.pdfFieldName);
      if (cfg.type === "multiline") t.enableMultiline();
      for (const b of own) t.addToPage(pages[b.page], { ...at(b), font });
      t.setFontSize(10);
    }
  }
  return doc.save();
}

/** How a value is printed: dates as dd/mm/yyyy like the rest of the app, and an
 *  address without the gaps of lines left blank. */
function printed(field: FieldConfig, value: string) {
  if (field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  if (field.clientKey === "address") return joinAddress(value.split(/\r?\n/));
  if (field.clientKey === "websiteUrls") return splitUrls(value).join(field.type === "multiline" ? "\n" : ", ");
  return value;
}

const FONT_SIZE = 10;
const MIN_FONT_SIZE = 6;

/** Lines `text` wraps to at `size` within `width`, breaking between words. */
function lineCount(text: string, font: PDFFont, size: number, width: number) {
  let count = 0;
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    count++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        count++;
        line = word;
      } else line = next;
    }
  }
  return count;
}

/** The largest size up to 10pt at which `text` fits the field's smallest box. */
function fittingSize(field: PDFTextField, text: string, font: PDFFont) {
  const rects = field.acroField.getWidgets().map((w) => w.getRectangle());
  if (rects.length === 0 || !text) return FONT_SIZE;
  const width = Math.min(...rects.map((r) => r.width)) - 4;
  const height = Math.min(...rects.map((r) => r.height)) - 2;
  for (let size = FONT_SIZE; size > MIN_FONT_SIZE; size -= 0.5) {
    const fits = field.isMultiline()
      ? lineCount(text, font, size, width) * font.heightAtSize(size) <= height
      : font.widthOfTextAtSize(text, size) <= width;
    if (fits) return size;
  }
  return MIN_FONT_SIZE;
}

/** The template with `values` (PDF field name → entered value) written in. The
 *  fields stay editable so the signing step (phase 2) can still add to them.
 *  Text that would overflow its box is printed smaller. */
export async function fillPdf(pdf: Uint8Array, fields: FieldConfig[], values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const field of fields) {
    if (field.type === "signature") continue;
    const value = (values[field.pdfFieldName] ?? "").trim();
    const f = form.getFieldMaybe(field.pdfFieldName);
    if (!f) continue;
    if (f instanceof PDFCheckBox) {
      if (value === "true") f.check();
      else f.uncheck();
    } else if (f instanceof PDFTextField) {
      const text = printed(field, value);
      if (f.acroField.getDefaultAppearance()) f.setFontSize(fittingSize(f, text, font));
      f.setText(text);
    } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
      if (value && f.getOptions().includes(value)) f.select(value);
      else f.clear();
    } else if (f instanceof PDFRadioGroup) {
      if (value && f.getOptions().includes(value)) f.select(value);
      else f.clear();
    }
  }
  form.updateFieldAppearances(font);
  return doc.save();
}
