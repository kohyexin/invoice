import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftForInvoice, pdfDataFromDraft, pdfFilename, renderInvoicePdf } from "@/lib/pdf/render";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("VIEWER");
  if (denied) return denied;
  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { alias: true, number: true, document: { select: { filename: true, contentType: true, data: true } } },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inline = new URL(req.url).searchParams.has("inline");
  const disposition = (name: string) => `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`;

  if (inv.document) {
    return new NextResponse(new Uint8Array(inv.document.data), {
      headers: { "Content-Type": inv.document.contentType, "Content-Disposition": disposition(inv.document.filename) },
    });
  }

  const draft = await draftForInvoice(params.id);
  if (!draft) return NextResponse.json({ error: "This invoice has no lines to print." }, { status: 404 });
  const pdf = await renderInvoicePdf(await pdfDataFromDraft(draft));
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition(pdfFilename(inv.alias, inv.number)) },
  });
}
