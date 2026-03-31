import { NextResponse } from "next/server";

import { joinPrivateTicket } from "@/lib/game-server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { roomCode?: string };
    return NextResponse.json(await joinPrivateTicket(request.headers, body.roomCode ?? ""));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to join private room."
      },
      { status: 400 }
    );
  }
}
