import { NextResponse } from "next/server";
import { signedSoFarPdf } from "@/lib/agreements/signing";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed copy once there is one, else the filled-in agreement with the signatures given so far. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("agreements");
  if (denied) return denied;
  const docs = await prisma.agreementDocument.findMany({
    where: { agreementId: params.id },
    select: { variant: true, filename: true, contentType: true, data: true, driveFileId: true },
  });
  const signedDoc = docs.find((d) => d.variant === "SIGNED");
  const filledDoc = docs.find((d) => d.variant === "FILLED");
  const doc = signedDoc ?? filledDoc;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inline = new URL(req.url).searchParams.has("inline");
  try {
    const data = signedDoc ? await readDocument(signedDoc) : (await signedSoFarPdf(params.id))?.pdf;
    if (!data) return NextResponse.json({ error: "This agreement's PDF is missing." }, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't fetch the PDF from Google Drive." }, { status: 502 });
  }
}
