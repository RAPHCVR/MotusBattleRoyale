import { NextResponse } from "next/server";

import { getReadyStatus } from "@/lib/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const ready = await getReadyStatus();

  return NextResponse.json(
    {
      ...ready,
      time: new Date().toISOString()
    },
    {
      status: ready.ok ? 200 : 503,
      headers: {
        "cache-control": "no-store"
      }
    }
  );
}
