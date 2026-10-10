import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reports activity: the middleware renews the activity cookie, or answers 401 once the user is idle. */
export function POST() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
