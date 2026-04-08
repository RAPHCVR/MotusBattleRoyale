import { NextResponse } from "next/server";

import { getGameMetrics } from "@/lib/game-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const metrics = await getGameMetrics();

  return NextResponse.json(metrics, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
