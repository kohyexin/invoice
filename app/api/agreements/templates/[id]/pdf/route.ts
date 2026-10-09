import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The blank template, for the field editor. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("agreements", "EDIT");
  if (denied) return denied;
  const t = await prisma.agreementTemplate.findUnique({ where: { id: params.id }, select: { pdf: true, pdfFilename: true } });
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(t.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(t.pdfFilename || "template.pdf")}`,
      "Cache-Control": "no-store",
    },
  });
}
