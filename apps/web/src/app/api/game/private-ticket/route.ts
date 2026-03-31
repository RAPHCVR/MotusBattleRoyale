import { NextResponse } from "next/server";

import { createPrivateTicket } from "@/lib/game-server";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await createPrivateTicket(request.headers));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create private room."
      },
      { status: 400 }
    );
  }
}
