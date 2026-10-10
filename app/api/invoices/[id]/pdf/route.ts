import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { draftForInvoice, pdfDataFromDraft, renderInvoicePdf } from "@/lib/pdf/render";
import { apiDenied } from "@/lib/session";
import { invoiceFilename, readDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = await apiDenied("invoices");
  if (denied) return denied;
  const inv = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { alias: true, number: true, invoiceDate: true, document: { select: { contentType: true, data: true, driveFileId: true } } },
  });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inline = new URL(req.url).searchParams.has("inline");
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(invoiceFilename(inv))}`;

  if (inv.document) {
    try {
      const data = await readDocument(inv.document);
      if (data) {
        return new NextResponse(data, {
          headers: { "Content-Type": inv.document.contentType, "Content-Disposition": disposition },
        });
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't fetch the PDF from Google Drive." }, { status: 502 });
    }
  }

  const draft = await draftForInvoice(params.id);
  if (!draft) return NextResponse.json({ error: "This invoice has no lines to print." }, { status: 404 });
  const pdf = await renderInvoicePdf(await pdfDataFromDraft(draft));
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": disposition },
  });
}
