import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("systemImports");
  if (denied) return denied;
  const row = await prisma.importReview.findUnique({ where: { id: params.id }, select: { filename: true, pdf: true } });
  if (!row?.pdf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(row.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename || "invoice.pdf")}`,
    },
  });
}
