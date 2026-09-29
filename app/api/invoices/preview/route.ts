import { NextResponse } from "next/server";
import { draftFromInput, type ComposerInput } from "@/lib/composer";
import { pdfDataFromDraft, renderInvoicePdf } from "@/lib/pdf/render";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await apiDenied("STAFF");
  if (denied) return denied;
  const input = (await req.json()) as ComposerInput;
  const res = draftFromInput(input);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  try {
    const pdf = await renderInvoicePdf(await pdfDataFromDraft(res.draft));
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not render the PDF." }, { status: 500 });
  }
}
