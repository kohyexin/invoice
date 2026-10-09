import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readDocument } from "@/lib/documents";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed copy once there is one, else the filled-in agreement. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("agreements");
  if (denied) return denied;
  const docs = await prisma.agreementDocument.findMany({
    where: { agreementId: params.id },
    select: { variant: true, filename: true, contentType: true, data: true, driveFileId: true },
  });
  const doc = docs.find((d) => d.variant === "SIGNED") ?? docs.find((d) => d.variant === "FILLED");
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inline = new URL(req.url).searchParams.has("inline");
  try {
    const data = await readDocument(doc);
    if (!data) return NextResponse.json({ error: "This agreement's PDF is missing." }, { status: 404 });
    return new NextResponse(data, {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't fetch the PDF from Google Drive." }, { status: 502 });
  }
}
