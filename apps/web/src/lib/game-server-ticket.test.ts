import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensurePlayerProfile: vi.fn(),
  generateOneTimeToken: vi.fn(),
  getSessionFromHeaders: vi.fn()
}));

vi.mock("./player-profile", () => ({
  ensurePlayerProfile: mocks.ensurePlayerProfile
}));

vi.mock("./auth", () => ({
  auth: {
    api: {
      generateOneTimeToken: mocks.generateOneTimeToken
    }
  }
}));

vi.mock("./session", () => ({
  getSessionFromHeaders: mocks.getSessionFromHeaders
}));

describe("game server ticket creation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.ensurePlayerProfile.mockReset();
    mocks.generateOneTimeToken.mockReset();
    mocks.getSessionFromHeaders.mockReset();
  });

  it("creates a private ticket through the server auth APIs", async () => {
    mocks.getSessionFromHeaders.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Emma"
      }
    });
    mocks.ensurePlayerProfile.mockResolvedValue(undefined);
    mocks.generateOneTimeToken.mockResolvedValue({
      token: "ott-123"
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ticketType: "private",
          token: "ticket-123",
          roomId: "room-123",
          wsEndpoint: "wss://motus.raphcvr.me/realtime",
          reservation: {
            name: "private-room",
            sessionId: "session-123",
            roomId: "room-123",
            processId: "process-123",
            reconnectionToken: "reconnect-123",
            devMode: false
          }
        }),
        {
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    const { createPrivateTicket } = await import("./game-server");
    const headers = new Headers({
      cookie: "session=abc",
      host: "motus.raphcvr.me",
      "x-forwarded-proto": "https"
    });

    const result = await createPrivateTicket(headers);

    expect(mocks.getSessionFromHeaders).toHaveBeenCalledWith(headers);
    expect(mocks.ensurePlayerProfile).toHaveBeenCalledWith({
      id: "user-1",
      name: "Emma"
    });
    expect(mocks.generateOneTimeToken).toHaveBeenCalledWith({ headers });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/internal/tickets/private"
    );
    expect(result.token).toBe("ticket-123");
    expect(result.roomId).toBe("room-123");
  });
});
