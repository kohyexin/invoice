import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refreshFxRates } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily FX pull. Called by the scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await refreshFxRates();
  revalidatePath("/settings");
  return NextResponse.json(result, { status: result.updated.length ? 200 : 502 });
}
