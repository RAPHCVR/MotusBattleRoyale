import { describe, expect, it } from "vitest";

import { ticketBundleSchema } from "../src/index.ts";

describe("protocol", () => {
  it("validates a ticket bundle shape", () => {
    const result = ticketBundleSchema.safeParse({
      ticketType: "public",
      token: "abc",
      roomId: "room-1",
      wsEndpoint: "ws://localhost:2567",
      reservation: {
        name: "public-queue",
        sessionId: "session-1",
        roomId: "room-1"
      }
    });

    expect(result.success).toBe(true);
  });
});
