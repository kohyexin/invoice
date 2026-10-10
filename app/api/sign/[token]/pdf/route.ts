import { NextResponse } from "next/server";
import { findSigner, rateLimited } from "@/lib/agreements/sign-link";
import { signedSoFarPdf } from "@/lib/agreements/signing";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The agreement as the signer sees it: with the signatures given so far, or the signed copy once complete. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (rateLimited(req)) return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
  const found = await findSigner(params.token);
  if (found.error) return found.error;
  const agreementId = found.signer.agreement.id;
  try {
    const signedDoc = await prisma.agreementDocument.findUnique({
      where: { agreementId_variant: { agreementId, variant: "SIGNED" } },
      select: { filename: true, data: true, driveFileId: true },
    });
    const result = signedDoc ? { pdf: await readDocument(signedDoc), filename: signedDoc.filename } : await signedSoFarPdf(agreementId);
    if (!result?.pdf) return NextResponse.json({ error: "The agreement's PDF is missing." }, { status: 404 });
    const download = new URL(req.url).searchParams.has("download");
    return new NextResponse(new Uint8Array(result.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't load the agreement. Please try again." }, { status: 502 });
  }
}
