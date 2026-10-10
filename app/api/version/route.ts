import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The deployment now serving requests; pages from an older one compare against it. */
export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
