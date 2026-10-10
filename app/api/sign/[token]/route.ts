import { NextResponse } from "next/server";
import { parseFieldConfig } from "@/lib/agreements/fields";
import { clientIp, findSigner, rateLimited as limited } from "@/lib/agreements/sign-link";
import { logSigningEvent, recordSignature, signatureBoxes, signerFields, signingTitle, type SignatureInput } from "@/lib/agreements/signing";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* The signing link, without a session: the token in the URL is the signer's
 * credential. GET describes what they are signing, POST records that they
 * opened it or signs. */

export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (limited(req)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
  const found = await findSigner(params.token);
  if (found.error) return found.error;
  const { signer } = found;
  const a = signer.agreement;
  const names = signerFields(parseFieldConfig(a.template.fieldConfig), signer.roleKey).map((f) => f.pdfFieldName);

  let boxes: { page: number; x: number; y: number; width: number; height: number }[] = [];
  if (a.status === "SENT" && signer.status !== "SIGNED") {
    const doc = await prisma.agreementDocument.findUnique({
      where: { agreementId_variant: { agreementId: a.id, variant: "FILLED" } },
      select: { data: true, driveFileId: true },
    });
    const pdf = doc ? await readDocument(doc) : null;
    if (pdf) boxes = (await signatureBoxes(pdf, a.templateId, names)).map(({ page, x, y, width, height }) => ({ page, x, y, width, height }));
  }

  return NextResponse.json({
    title: signingTitle(a),
    agreementStatus: a.status,
    signer: { name: signer.name, email: signer.email, roleLabel: signer.roleLabel, status: signer.status },
    others: a.signers.filter((s) => s.id !== signer.id).map((s) => ({ roleLabel: s.roleLabel, name: s.name, signed: s.status === "SIGNED" })),
    boxes,
  });
}

type Body = SignatureInput & { action?: string };

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (limited(req)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
  const found = await findSigner(params.token);
  if (found.error) return found.error;
  const { signer } = found;
  const a = signer.agreement;
  const body = (await req.json().catch(() => ({}))) as Body;

  if (body.action === "view") {
    if (signer.status === "PENDING" && a.status === "SENT") {
      const first = await prisma.agreementSigner.updateMany({ where: { id: signer.id, status: "PENDING" }, data: { status: "VIEWED", openedAt: new Date() } });
      if (first.count) await logSigningEvent(a.id, "viewed", signer.id, { ip: clientIp(req) });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "sign") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const res = await recordSignature(signer.id, body, {
    ip: clientIp(req),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    via: "link",
    actor: null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, completed: res.completed });
}
