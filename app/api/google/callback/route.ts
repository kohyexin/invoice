import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { connectDrive, googleRedirectUri } from "@/lib/gdrive";
import { syncPendingDocuments } from "@/lib/documents";
import { getCurrentUser } from "@/lib/session";
import { hasRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (params: Record<string, string>) => NextResponse.redirect(new URL(`/settings?${new URLSearchParams(params)}`, req.url));

  const user = await getCurrentUser();
  if (!user || !hasRole(user.role, "ADMIN")) return back({ drive: "error", reason: "You do not have permission to do this." });
  if (url.searchParams.get("error")) return back({ drive: "error", reason: "Google sign-in was cancelled." });

  try {
    const { payload } = await jwtVerify(url.searchParams.get("state") ?? "", new TextEncoder().encode(process.env.SESSION_SECRET!));
    if (payload.purpose !== "gdrive" || payload.sub !== user.id) throw new Error();
  } catch {
    return back({ drive: "error", reason: "The sign-in link expired. Try connecting again." });
  }

  try {
    await connectDrive(url.searchParams.get("code") ?? "", googleRedirectUri(req));
  } catch (e) {
    return back({ drive: "error", reason: e instanceof Error ? e.message : "Couldn't connect Google Drive." });
  }
  await syncPendingDocuments(30_000).catch(() => undefined);
  return back({ drive: "connected" });
}
