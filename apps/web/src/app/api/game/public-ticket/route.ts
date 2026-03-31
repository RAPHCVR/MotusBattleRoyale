import { NextResponse } from "next/server";

import { createPublicTicket } from "@/lib/game-server";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createPublicTicket(request.headers));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create public ticket."
      },
      { status: 400 }
    );
  }
}
