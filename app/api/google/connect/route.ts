import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { driveAuthUrl, driveConfigured, googleRedirectUri } from "@/lib/gdrive";
import { getCurrentUser } from "@/lib/session";
import { hasRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts "Connect Google Drive": sends an admin to Google's consent screen. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.role, "ADMIN")) return NextResponse.redirect(new URL("/settings", req.url));
  if (!driveConfigured()) return NextResponse.redirect(new URL("/settings?drive=not-configured", req.url));

  const state = await new SignJWT({ purpose: "gdrive" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  return NextResponse.redirect(driveAuthUrl(googleRedirectUri(req), state));
}
