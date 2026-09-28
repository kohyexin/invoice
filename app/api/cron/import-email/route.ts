import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchMailbox, mailboxConfigured } from "@/lib/system-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called by the scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!mailboxConfigured()) return NextResponse.json({ error: "Mailbox not configured" }, { status: 503 });

  try {
    const outcomes = await fetchMailbox();
    revalidatePath("/invoices");
    revalidatePath("/imports");
    revalidatePath("/dashboard");
    const count = (s: string) => outcomes.filter((o) => o.status === s).length;
    return NextResponse.json({
      imported: count("imported"),
      duplicate: count("duplicate"),
      review: count("review"),
      skipped: count("skipped"),
      outcomes,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Mailbox fetch failed" }, { status: 500 });
  }
}
