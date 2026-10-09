import { NextResponse } from "next/server";
import { syncPendingAgreementDocuments } from "@/lib/agreement-documents";
import { syncPendingDocuments } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily retry for invoice and agreement PDFs that couldn't reach Google Drive when they were saved. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const invoices = await syncPendingDocuments(35_000);
  const agreements = await syncPendingAgreementDocuments(10_000);
  return NextResponse.json({ ...invoices, agreements });
}
