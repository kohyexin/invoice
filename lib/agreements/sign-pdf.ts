import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { FieldBox } from "./fields";

/** One signer's signature, the signature fields it goes into, and the code printed under it. */
export type SignatureStamp = { fieldNames: string[]; png: Uint8Array; name: string; signedAt: Date; code: string };

/** Signature dates print in Hong Kong time, where the company signs. */
function signedDate(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

const INK = rgb(0.12, 0.12, 0.16);
/** Below this box height there's no room for the frame; only the signature is drawn. */
const MIN_FRAMED_HEIGHT = 22;

/** Draws each signature into every box of its fields, DocuSign style: a bracket
 *  on the left, "Signed by:" above, and the signature code and date below. With
 *  an envelope ID, it's printed in the top margin of every page so each page can
 *  be matched to this signing. The filled values and fields are left as they are. */
export async function stampSignatures(pdf: Uint8Array, stamps: SignatureStamp[], boxes: FieldBox[], envelopeId?: string): Promise<Uint8Array> {
  if (stamps.length === 0 && !envelopeId) return pdf;
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (envelopeId) {
    for (const page of pages) {
      const box = page.getCropBox();
      page.drawText(`STAR SAAS Envelope ID: ${envelopeId}`, { x: box.x + 18, y: box.y + box.height - 14, size: 7, font, color: rgb(0.35, 0.37, 0.42) });
    }
  }
  for (const s of stamps) {
    const image = await doc.embedPng(s.png);
    for (const b of boxes.filter((x) => s.fieldNames.includes(x.pdfFieldName))) {
      const page = pages[b.page];
      if (!page) continue;
      if (b.height < MIN_FRAMED_HEIGHT) {
        drawFitted(page, image, b.x, b.y, b.width, b.height);
        continue;
      }
      const text = Math.min(6.5, Math.max(4, b.height * 0.15));
      const indent = text * 1.4;
      const top = b.y + b.height;
      const labelY = top - text;
      const footerY = b.y + 0.5;
      const frame = { x: b.x + 1, top: labelY + text * 0.35, bottom: footerY + text * 0.35, r: Math.min(3, text * 0.6) };

      page.drawText("Signed by:", { x: b.x + indent, y: labelY, size: text, font: bold, color: INK });
      const footer = `${s.code}... · ${signedDate(s.signedAt)}`;
      page.drawText(fit(footer, font, text, b.width - indent) ? footer : `${s.code.slice(0, 8)}...`, { x: b.x + indent, y: footerY, size: text, font, color: INK });
      // [-shaped bracket with rounded corners, joining the label and the code.
      page.drawSvgPath(
        `M ${indent - 1.5} 0 H ${frame.r} Q 0 0 0 ${frame.r} V ${frame.top - frame.bottom - frame.r} Q 0 ${frame.top - frame.bottom} ${frame.r} ${frame.top - frame.bottom} H ${indent - 1.5}`,
        { x: frame.x, y: frame.top, borderColor: INK, borderWidth: 0.6 }
      );
      const gap = text * 0.35;
      drawFitted(page, image, b.x + indent, footerY + text + gap, b.width - indent - 1, labelY - gap - (footerY + text + gap));
    }
  }
  return doc.save();
}

function drawFitted(page: PDFPage, image: Awaited<ReturnType<PDFDocument["embedPng"]>>, x: number, y: number, width: number, height: number) {
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, { x, y: y + (height - h) / 2, width: w, height: h });
}

function fit(text: string, font: PDFFont, size: number, width: number) {
  try {
    return font.widthOfTextAtSize(text, size) <= width;
  } catch {
    return false;
  }
}
