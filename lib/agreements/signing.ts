import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { logActivity } from "@/lib/activity";
import { agreementFilename, archiveSignedAgreement } from "@/lib/agreement-documents";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";
import { sendAgreementCompletedEmail } from "@/lib/email";
import { sha256 } from "@/lib/mfa";
import { PDFDocument } from "pdf-lib";
import { appendCertificate } from "./certificate";
import { parseFieldConfig, type FieldBox, type FieldConfig } from "./fields";
import { fieldBoxes } from "./pdf";
import { stampSignatures } from "./sign-pdf";

/* E-signing: every signer gets their own emailed link at once (parallel).
 * Signatures are kept on the signer rows and stamped onto the clean filled PDF
 * whenever it is shown; once everyone has signed, that stamped PDF becomes the
 * signed copy on Google Drive. */

/** A fresh signing link token: the raw value goes in the email, only its hash is stored. */
export function newSignToken(linkDays: number) {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token), tokenExpiresAt: new Date(Date.now() + linkDays * 86_400_000) };
}

/** The app's public address for links in emails: the one set in Settings, else the request's. */
export function appOrigin(appUrl?: string) {
  if (appUrl) return appUrl;
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  } catch {
    /* not in a request */
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

export const signLink = (token: string, appUrl?: string) => `${appOrigin(appUrl)}/sign/${token}`;

/** The signature fields a signer role fills. */
export const signerFields = (fields: FieldConfig[], role: string) => fields.filter((f) => f.type === "signature" && f.signerRole === role);

/** "PCI Agreement SPC-09102026 · Acme Ltd", for emails and the signing page. */
export function signingTitle(a: { agreementRef: string; template: { name: string }; client: { name: string } }) {
  return `${a.template.name}${a.agreementRef ? ` ${a.agreementRef}` : ""} · ${a.client.name}`;
}

/** Records the signer's name as it was at the time, so history still reads right after a reassignment. */
export async function logSigningEvent(agreementId: string, type: string, signerId?: string | null, detail: Record<string, unknown> = {}) {
  if (signerId && detail.name === undefined) {
    const s = await prisma.agreementSigner.findUnique({ where: { id: signerId }, select: { name: true } });
    if (s) detail = { ...detail, name: s.name };
  }
  await prisma.agreementSigningEvent.create({ data: { agreementId, type, signerId: signerId ?? null, detail: detail as object } });
}

/** Where the named signature fields sit on an agreement's filled PDF. A field
 *  placed on the template after the agreement was filled isn't in that PDF;
 *  its place is taken from the template instead. */
export async function signatureBoxes(filled: Uint8Array, templateId: string, names: string[]): Promise<FieldBox[]> {
  const own = (await fieldBoxes(filled)).filter((b) => names.includes(b.pdfFieldName));
  const missing = names.filter((n) => !own.some((b) => b.pdfFieldName === n));
  if (missing.length === 0) return own;
  const template = await prisma.agreementTemplate.findUnique({ where: { id: templateId }, select: { pdf: true } });
  if (!template) return own;
  const fromTemplate = (await fieldBoxes(new Uint8Array(template.pdf))).filter((b) => missing.includes(b.pdfFieldName));
  return [...own, ...fromTemplate];
}

/** The filled PDF with every signature given so far. */
export async function signedSoFarPdf(agreementId: string): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const a = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: {
      agreementRef: true,
      templateId: true,
      template: { select: { code: true, fieldConfig: true } },
      client: { select: { name: true } },
      documents: { where: { variant: "FILLED" }, select: { data: true, driveFileId: true } },
      signers: { where: { status: "SIGNED", signature: { not: null } }, select: { id: true, roleKey: true, name: true, signature: true, signedAt: true } },
    },
  });
  const doc = a?.documents[0];
  if (!a || !doc) return null;
  const filled = await readDocument(doc);
  if (!filled) return null;
  const fields = parseFieldConfig(a.template.fieldConfig);
  const stamps = a.signers.map((s) => ({
    fieldNames: signerFields(fields, s.roleKey).map((f) => f.pdfFieldName),
    png: new Uint8Array(s.signature!),
    name: s.name,
    signedAt: s.signedAt ?? new Date(),
    code: signatureCode(s.id),
  }));
  const boxes = stamps.length ? await signatureBoxes(filled, a.templateId, stamps.flatMap((s) => s.fieldNames)) : [];
  const pdf = await stampSignatures(filled, stamps, boxes, envelopeId(agreementId));
  return { pdf, filename: agreementFilename(a) };
}

/** The ID printed on every page and on the certificate, DocuSign "envelope ID" style. */
export function envelopeId(agreementId: string) {
  const h = sha256(`envelope:${agreementId}`).slice(0, 32).toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The final signed copy: signatures and envelope ID on every page, a flattened
 *  form, and the certificate of completion at the end. */
export async function buildSignedCopy(agreementId: string): Promise<{ pdf: Uint8Array } | null> {
  const stamped = await signedSoFarPdf(agreementId);
  if (!stamped) return null;
  const a = await prisma.agreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      agreementRef: true,
      sentAt: true,
      completedAt: true,
      template: { select: { name: true } },
      client: { select: { name: true } },
      signers: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, roleLabel: true, signature: true, openedAt: true, signedAt: true, signedIp: true, signedUserAgent: true },
      },
      events: { orderBy: { createdAt: "asc" }, select: { type: true, signerId: true, detail: true, createdAt: true } },
    },
  });
  const sender = await prisma.activityLog.findFirst({
    where: { entity: "agreement", entityId: agreementId, action: "send" },
    orderBy: { createdAt: "desc" },
    select: { actorName: true },
  });

  const doc = await PDFDocument.load(stamped.pdf, { ignoreEncryption: true });
  try {
    // The appearances already show the filled values; regenerating them would lose non-Latin text.
    doc.getForm().flatten({ updateFieldAppearances: false });
  } catch {
    /* an odd field: leave the form as it is */
  }
  const pages = doc.getPageCount();
  const flat = await doc.save();

  // Only this round of signing: anything before the last cancellation belongs to an earlier one.
  const lastVoid = a.events.findLastIndex((e) => e.type === "voided");
  const events = a.events.slice(lastVoid + 1);
  const detailOf = (e: (typeof events)[number]) => (e.detail ?? {}) as Record<string, string | undefined>;
  const pdf = await appendCertificate(flat, {
    envelopeId: envelopeId(agreementId),
    title: signingTitle(a),
    pages,
    sender: sender?.actorName ?? "",
    sentAt: a.sentAt,
    completedAt: a.completedAt ?? new Date(),
    signers: a.signers.map((s) => {
      const signedEvent = events.findLast((e) => e.signerId === s.id && e.type === "signed");
      const invited = events.findLast((e) => e.signerId === s.id && (e.type === "sent" || e.type === "reassigned"));
      return {
        name: s.name,
        email: s.email,
        roleLabel: s.roleLabel,
        png: s.signature ? new Uint8Array(s.signature) : null,
        code: signatureCode(s.id),
        via: signedEvent ? (detailOf(signedEvent).via === "app" ? "In the app (signed in)" : "Email link") : "",
        ip: s.signedIp === "app" ? "" : s.signedIp,
        userAgent: s.signedUserAgent,
        sentAt: invited?.createdAt ?? a.sentAt,
        viewedAt: s.openedAt,
        signedAt: s.signedAt,
      };
    }),
  });
  return { pdf };
}

const MAX_SIGNATURE_BYTES = 400_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Short code printed under each signature on the PDF, like DocuSign's envelope id. */
export const signatureCode = (signerId: string) => sha256(`signature:${signerId}`).slice(0, 15).toUpperCase();

export type SignatureInput = { signature?: string; name?: string; agree?: boolean };

/** Records one signer's signature, from their emailed link or in the app
 *  (`actor` is the signed-in user), then completes the agreement when it was the last one. */
export async function recordSignature(
  signerId: string,
  input: SignatureInput,
  meta: { ip: string; userAgent: string; via: "link" | "app"; actor: Parameters<typeof logActivity>[0] }
): Promise<{ ok: true; completed: boolean } | { ok: false; error: string; status: number }> {
  const signer = await prisma.agreementSigner.findUnique({
    where: { id: signerId },
    select: {
      id: true,
      name: true,
      email: true,
      roleLabel: true,
      status: true,
      agreement: { select: { id: true, status: true, agreementRef: true, template: { select: { code: true } }, client: { select: { name: true } } } },
    },
  });
  if (!signer) return { ok: false, error: "Signer not found.", status: 404 };
  const a = signer.agreement;
  if (a.status !== "SENT") return { ok: false, error: "This agreement isn't waiting for signatures any more.", status: 409 };
  if (signer.status === "SIGNED") return { ok: false, error: "You've already signed this agreement.", status: 409 };
  if (!input.agree) return { ok: false, error: "Please confirm that you agree to sign.", status: 400 };
  const name = (input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) return { ok: false, error: "Enter your full name.", status: 400 };
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.signature ?? "");
  const png = match ? Buffer.from(match[1], "base64") : null;
  if (!png || png.length < 100 || png.length > MAX_SIGNATURE_BYTES || !png.subarray(0, 8).equals(PNG_MAGIC)) {
    return { ok: false, error: "Draw your signature first.", status: 400 };
  }

  const signed = await prisma.agreementSigner.updateMany({
    where: { id: signer.id, status: { not: "SIGNED" } },
    data: { status: "SIGNED", signedAt: new Date(), name, signature: png, signedIp: meta.ip, signedUserAgent: meta.userAgent },
  });
  if (signed.count === 0) return { ok: false, error: "You've already signed this agreement.", status: 409 };
  await prisma.agreementSigner.updateMany({ where: { id: signer.id, openedAt: null }, data: { openedAt: new Date() } });
  await logSigningEvent(a.id, "signed", signer.id, {
    via: meta.via,
    ip: meta.ip,
    userAgent: meta.userAgent,
    code: signatureCode(signer.id),
    ...(name !== signer.name ? { nameAsSent: signer.name } : {}),
  });
  await logActivity(meta.actor, {
    action: "sign",
    entity: "agreement",
    entityId: a.id,
    label: [a.template.code, a.agreementRef, a.client.name].filter(Boolean).join(" · "),
    changes: { signer: `${signer.roleLabel}: ${name} <${signer.email}>`, via: meta.via === "app" ? "In the app" : "Email link" },
  });
  return { ok: true, completed: await completeIfAllSigned(a.id) };
}

/** After a signature: when everyone has signed, files the signed copy on Drive
 *  and emails it to every signer. Runs once even if the last two sign together. */
export async function completeIfAllSigned(agreementId: string) {
  const left = await prisma.agreementSigner.count({ where: { agreementId, status: { not: "SIGNED" } } });
  if (left > 0) return false;
  const claimed = await prisma.agreement.updateMany({ where: { id: agreementId, status: "SENT" }, data: { status: "COMPLETED", completedAt: new Date() } });
  if (claimed.count === 0) return false;

  const a = await prisma.agreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      agreementRef: true,
      template: { select: { name: true, code: true } },
      client: { select: { name: true } },
      signers: { select: { name: true, email: true } },
    },
  });
  await logSigningEvent(agreementId, "completed");
  const signed = await buildSignedCopy(agreementId);
  if (signed) {
    await archiveSignedAgreement(agreementId, signed.pdf);
    const title = signingTitle(a);
    for (const s of a.signers) await sendAgreementCompletedEmail(s.email, s.name, title, { filename: agreementFilename(a, true), content: signed.pdf });
  }
  await logActivity(null, {
    action: "complete",
    entity: "agreement",
    entityId: agreementId,
    label: [a.template.code, a.agreementRef, a.client.name].filter(Boolean).join(" · "),
    changes: { signers: a.signers.map((s) => s.name).join(", ") },
  });
  return true;
}
