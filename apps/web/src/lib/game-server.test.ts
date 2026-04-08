import { describe, expect, it } from "vitest";

import { resolveAppOrigin, resolveTicketWsEndpoint } from "./game-server";

describe("game server origin resolution", () => {
  it("uses the loopback origin for local development requests", () => {
    const headers = new Headers({
      host: "127.0.0.1:3000",
    });

    expect(
      resolveAppOrigin(headers, {
        appUrl: "https://motus.raphcvr.me",
        localDevEnabled: true,
      }),
    ).toBe("http://127.0.0.1:3000");

    expect(
      resolveTicketWsEndpoint(headers, "wss://motus.raphcvr.me/realtime", {
        appUrl: "https://motus.raphcvr.me",
        localDevEnabled: true,
        realtimeOrigin: "http://localhost:2567",
      }),
    ).toBe("ws://127.0.0.1:2567");
  });

  it("ignores spoofed forwarded hosts outside local development", () => {
    const headers = new Headers({
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });

    expect(
      resolveAppOrigin(headers, {
        appUrl: "https://motus.raphcvr.me",
        localDevEnabled: false,
      }),
    ).toBe("https://motus.raphcvr.me");

    expect(
      resolveTicketWsEndpoint(headers, "wss://motus.raphcvr.me/realtime", {
        appUrl: "https://motus.raphcvr.me",
        localDevEnabled: false,
      }),
    ).toBe("wss://motus.raphcvr.me/realtime");
  });

  it("applies the tunnel host on top of the canonical app origin", () => {
    const headers = new Headers({
      host: "spoofed.example",
      "x-forwarded-proto": "https",
    });

    expect(
      resolveTicketWsEndpoint(headers, "wss://motus.raphcvr.me/realtime", {
        appUrl: "https://motus.raphcvr.me",
        localDevEnabled: false,
        tunnelHost: "rt.raphcvr.me",
      }),
    ).toBe("wss://rt.raphcvr.me/realtime");
  });
});
