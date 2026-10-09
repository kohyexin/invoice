import { NextResponse } from "next/server";
import { isInput, parseFieldConfig } from "@/lib/agreements/fields";
import { fillPdf } from "@/lib/agreements/pdf";
import { prisma } from "@/lib/db";
import { apiDenied } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The template filled with `values`, or with each field's own name when `names` is set. Nothing is saved. */
export async function POST(req: Request) {
  const denied = await apiDenied("agreements", "EDIT");
  if (denied) return denied;
  const body = (await req.json()) as { templateId?: string; values?: Record<string, string>; names?: boolean };
  const template = body.templateId
    ? await prisma.agreementTemplate.findUnique({ where: { id: body.templateId }, select: { pdf: true, fieldConfig: true } })
    : null;
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const all = parseFieldConfig(template.fieldConfig);
  const fields = body.names ? all.map((f) => ({ ...f, type: f.type === "date" ? ("text" as const) : f.type })) : all.filter(isInput);
  const values = body.names ? Object.fromEntries(all.map((f) => [f.pdfFieldName, f.pdfFieldName])) : body.values ?? {};
  try {
    const pdf = await fillPdf(new Uint8Array(template.pdf), fields, values);
    return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not render the PDF." }, { status: 500 });
  }
}
