import { NextResponse } from "next/server";
import { draftFromInput, type ComposerInput } from "@/lib/composer";
import { pdfDataFromDraft, renderInvoicePdf } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
