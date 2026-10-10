import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import * as fontkit from "fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

/* The "Certificate of Completion" appended to a fully signed agreement, like
 * DocuSign's: the envelope, and each signer with their signature and how, when
 * and from where they signed. Every party receives it, so internal steps
 * (reminders, reassignments) stay out; those are in the app's signing history.
 * Times are Hong Kong time. */

export type CertificateSigner = {
  name: string;
  email: string;
  roleLabel: string;
  png: Uint8Array | null;
  code: string;
  via: string;
  ip: string;
  userAgent: string;
  sentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
};

export type CertificateData = {
  envelopeId: string;
  title: string;
  pages: number;
  sender: string;
  sentAt: Date | null;
  completedAt: Date;
  signers: CertificateSigner[];
};

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.86, 0.89, 0.93);
const LABEL_W = 150;

export function certificateTime(d: Date | null) {
  if (!d) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${parts.replace(",", "")} HKT`;
}

const needsCjk = (s: string) => /[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac]/.test(s);

/* pdf-lib's own fontkit drops glyphs when subsetting Noto Sans SC; fontkit 2
 * subsets it correctly but only offers encode(), where pdf-lib wants a stream. */
const fontkitForPdfLib = {
  create(data: Uint8Array, postscriptName?: string) {
    const font = fontkit.create(Buffer.from(data), postscriptName);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      subset.encodeStream = () => {
        const on: Record<string, (x?: unknown) => void> = {};
        const stream = {
          on(event: string, fn: (x?: unknown) => void) {
            on[event] = fn;
            if (event === "end") {
              queueMicrotask(() => {
                try {
                  on.data?.(subset.encode());
                  on.end?.();
                } catch (e) {
                  on.error?.(e);
                }
              });
            }
            return stream;
          },
        };
        return stream;
      };
      return subset;
    };
    return font;
  },
} as unknown as Parameters<PDFDocument["registerFontkit"]>[0];

async function loadNoto(doc: PDFDocument) {
  doc.registerFontkit(fontkitForPdfLib);
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([fs.readFile(path.join(dir, "NotoSansSC-Regular.ttf")), fs.readFile(path.join(dir, "NotoSansSC-Bold.ttf"))]);
  return { regular: await doc.embedFont(regular, { subset: true }), bold: await doc.embedFont(bold, { subset: true }) };
}

export async function appendCertificate(pdf: Uint8Array, data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const helv = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const strings = [data.title, data.sender, ...data.signers.flatMap((s) => [s.name, s.email, s.roleLabel, s.userAgent])];
  const noto = strings.some(needsCjk) ? await loadNoto(doc) : null;
  const fontFor = (s: string, bold = false): PDFFont => (noto && needsCjk(s) ? (bold ? noto.bold : noto.regular) : bold ? helv.bold : helv.regular);
  const images = new Map<CertificateSigner, PDFImage>();
  for (const s of data.signers) if (s.png) images.set(s, await doc.embedPng(s.png));

  let page: PDFPage = undefined as unknown as PDFPage;
  let y = 0;

  const text = (s: string, x: number, at: number, size: number, opts: { bold?: boolean; color?: typeof INK } = {}) =>
    page.drawText(s, { x, y: at, size, font: fontFor(s, opts.bold), color: opts.color ?? INK });

  const wrap = (s: string, width: number, size: number, bold = false) => {
    const font = fontFor(s, bold);
    const lines: string[] = [];
    for (const word of s.split(/(\s+)/)) {
      const last = lines.length ? lines[lines.length - 1] : "";
      const joined = last + word;
      if (lines.length && font.widthOfTextAtSize(joined, size) <= width) lines[lines.length - 1] = joined;
      else if (font.widthOfTextAtSize(word, size) <= width) lines.push(word.trimStart());
      else {
        // A word wider than the column (long IDs, CJK runs): break it by character.
        let chunk = "";
        for (const ch of Array.from(word)) {
          if (chunk && font.widthOfTextAtSize(chunk + ch, size) > width) {
            lines.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        if (chunk) lines.push(chunk);
      }
    }
    return lines.length ? lines : [""];
  };

  const footer = () => {
    page.drawLine({ start: { x: M, y: M - 6 }, end: { x: W - M, y: M - 6 }, thickness: 0.5, color: LINE });
    text("Recorded by STAR SAAS e-signing.", M, M - 18, 7, { color: MUTED });
  };

  const newPage = () => {
    page = doc.addPage([W, H]);
    text(`STAR SAAS Envelope ID: ${data.envelopeId}`, 18, H - 14, 7, { color: MUTED });
    footer();
    y = H - M;
  };

  const ensure = (h: number) => {
    if (y - h < M + 8) newPage();
  };

  const heading = (s: string) => {
    ensure(40);
    y -= 14;
    text(s, M, y, 11, { bold: true });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    y -= 14;
  };

  const row = (label: string, value: string, x = M, labelW = LABEL_W, size = 9) => {
    const lines = wrap(value, W - M - x - labelW, size);
    ensure(lines.length * (size + 4));
    text(label, x, y, size, { color: MUTED });
    lines.forEach((l, i) => text(l, x + labelW, y - i * (size + 4), size));
    y -= lines.length * (size + 4) + 2;
  };

  newPage();
  text("Certificate of Completion", M, y - 18, 20, { bold: true });
  y -= 36;
  text("The electronic signing record for this agreement.", M, y, 9, { color: MUTED });
  y -= 22;

  heading("Envelope");
  row("Envelope ID", data.envelopeId);
  row("Document", data.title);
  row("Pages", `${data.pages} (plus this certificate)`);
  row("Status", "Completed: signed by every party");
  row("Sent by", data.sender || "-");
  row("Sent", certificateTime(data.sentAt));
  row("Completed", certificateTime(data.completedAt));

  heading("Signers");
  for (const s of data.signers) {
    const detailX = M + 190;
    const details: [string, string][] = [
      ["Signature code", s.code],
      ["Signed via", s.via || "-"],
      ["IP address", s.ip || "-"],
      ["Sent", certificateTime(s.sentAt)],
      ["Viewed", certificateTime(s.viewedAt)],
      ["Signed", certificateTime(s.signedAt)],
    ];
    const agent = s.userAgent ? wrap(s.userAgent, W - M - detailX - 80, 7.5).slice(0, 3) : [];
    const blockH = Math.max(96, 30 + details.length * 12 + agent.length * 10 + 6);
    ensure(blockH + 12);
    const top = y;

    // Signature, framed like the stamp on the agreement itself.
    const frameTop = top + 2;
    const frameBottom = top - 76;
    text("Signed by:", M + 9, top - 6, 7, { bold: true });
    page.drawSvgPath(`M 7 0 H 3 Q 0 0 0 3 V ${frameTop - frameBottom - 3} Q 0 ${frameTop - frameBottom} 3 ${frameTop - frameBottom} H 7`, {
      x: M,
      y: frameTop,
      borderColor: INK,
      borderWidth: 0.6,
    });
    const img = images.get(s);
    if (img) {
      const scale = Math.min(160 / img.width, 50 / img.height);
      page.drawImage(img, { x: M + 9, y: top - 62 + (50 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
    text(`${s.code}...`, M + 9, top - 74, 7);

    let dy = top;
    const nameLines = wrap(s.name, W - M - detailX, 10, true);
    nameLines.forEach((l, i) => text(l, detailX, dy - i * 13, 10, { bold: true }));
    dy -= nameLines.length * 13;
    text(`${s.email} · ${s.roleLabel}`, detailX, dy, 8.5, { color: MUTED });
    dy -= 15;
    for (const [label, value] of details) {
      text(label, detailX, dy, 8, { color: MUTED });
      text(value, detailX + 80, dy, 8);
      dy -= 12;
    }
    if (agent.length) {
      text("Device", detailX, dy, 8, { color: MUTED });
      agent.forEach((l, i) => text(l, detailX + 80, dy - i * 10, 7.5));
      dy -= agent.length * 10;
    }
    y = Math.min(dy, top - 84) - 10;
    page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  return doc.save();
}
