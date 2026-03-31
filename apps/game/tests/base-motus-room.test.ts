import { afterEach, describe, expect, it } from "vitest";

import type { GameTokenClaims, RoomSnapshot } from "@motus/protocol";

import { PrivateLobbyRoom } from "../src/rooms/PrivateLobbyRoom.js";
import { PublicQueueRoom } from "../src/rooms/PublicQueueRoom.js";

type FakeClient = {
  sessionId: string;
  auth?: GameTokenClaims;
};

function createClaims(
  userId: string,
  roomKind: "public" | "private",
  overrides: Partial<GameTokenClaims> = {}
): GameTokenClaims {
  return {
    sub: userId,
    sessionId: `session-${userId}`,
    name: `Player ${userId}`,
    avatarSeed: `avatar-${userId}`,
    mmr: 1_200,
    isAnonymous: true,
    roomKind,
    roomCode: roomKind === "private" ? "ROOM42" : undefined,
    ticketId: `ticket-${userId}`,
    iat: 1_700_000_000,
    exp: 1_700_000_300,
    ...overrides
  };
}

class TestPublicRoom extends PublicQueueRoom {
  public didLock = false;
  public phaseUpdates: RoomSnapshot[] = [];

  async create(): Promise<void> {
    (this as { roomId: string }).roomId = "public-room";
    await this.onCreate({ seed: "public-seed" });
  }

  async joinClient(client: FakeClient, claims: GameTokenClaims): Promise<void> {
    await this.onJoin(client as never, undefined, claims);
  }

  async forceStart(): Promise<void> {
    await this.tryStartMatch();
  }

  get snapshot(): RoomSnapshot {
    return this.buildRoomSnapshot();
  }

  cleanup(): void {
    this.clock.clear();
  }

  async setPrivate(): Promise<void> {}

  async setMatchmaking(): Promise<void> {}

  async lock(): Promise<void> {
    this.didLock = true;
  }

  async disconnect(): Promise<void> {}

  broadcast(type: string, payload?: unknown): boolean {
    if (type === "phase:update" && payload) {
      this.phaseUpdates.push(payload as RoomSnapshot);
    }

    return true;
  }

  send(): void {}
}

class TestPrivateRoom extends PrivateLobbyRoom {
  public phaseUpdates: RoomSnapshot[] = [];

  async create(): Promise<void> {
    (this as { roomId: string }).roomId = "private-room";
    await this.onCreate({ roomCode: "ROOM42", seed: "private-seed" });
  }

  async joinClient(client: FakeClient, claims: GameTokenClaims): Promise<void> {
    await this.onJoin(client as never, undefined, claims);
  }

  async toggleReady(client: FakeClient): Promise<void> {
    await this.handleReadyToggle(client as never);
  }

  async hostStart(client: FakeClient): Promise<void> {
    await this.handleHostStart(client as never);
  }

  get snapshot(): RoomSnapshot {
    return this.buildRoomSnapshot();
  }

  cleanup(): void {
    this.clock.clear();
  }

  async setPrivate(): Promise<void> {}

  async setMatchmaking(): Promise<void> {}

  async lock(): Promise<void> {}

  async disconnect(): Promise<void> {}

  broadcast(type: string, payload?: unknown): boolean {
    if (type === "phase:update" && payload) {
      this.phaseUpdates.push(payload as RoomSnapshot);
    }

    return true;
  }

  send(): void {}
}

const createdRooms: Array<{ cleanup: () => void }> = [];

afterEach(() => {
  while (createdRooms.length) {
    createdRooms.pop()?.cleanup();
  }
});

describe("BaseMotusRoom", () => {
  it("starts the public countdown automatically once the minimum field joins", async () => {
    const room = new TestPublicRoom();
    createdRooms.push(room);
    await room.create();

    await room.joinClient({ sessionId: "c1" }, createClaims("u1", "public"));
    expect(room.snapshot.phase).toBe("queue");
    expect(room.snapshot.countdownEndsAt).toBeUndefined();

    await room.joinClient({ sessionId: "c2" }, createClaims("u2", "public"));

    expect(room.snapshot.phase).toBe("countdown");
    expect((room.snapshot.countdownEndsAt ?? 0) - Date.now()).toBeGreaterThan(15_000);
  });

  it("deduplicates reconnecting players instead of duplicating the roster", async () => {
    const room = new TestPublicRoom();
    createdRooms.push(room);
    await room.create();

    await room.joinClient({ sessionId: "first" }, createClaims("u1", "public"));
    await room.joinClient({ sessionId: "second" }, createClaims("u1", "public", { sessionId: "session-reconnect" }));

    expect(room.snapshot.players).toHaveLength(1);
    expect(room.snapshot.players[0]?.connected).toBe(true);
  });

  it("requires the private join token to match the room code", async () => {
    const room = new TestPrivateRoom();
    createdRooms.push(room);
    await room.create();

    await expect(
      room.joinClient({ sessionId: "bad" }, createClaims("u1", "private", { roomCode: "WRONG1" }))
    ).rejects.toThrow("Wrong room code.");
  });

  it("starts the private countdown only when every active player is ready and cancels when one unreadies", async () => {
    const room = new TestPrivateRoom();
    createdRooms.push(room);
    await room.create();

    const host = { sessionId: "host-client" };
    const guest = { sessionId: "guest-client" };

    await room.joinClient(host, createClaims("host", "private"));
    await room.joinClient(guest, createClaims("guest", "private", { sessionId: "session-guest" }));

    expect(room.snapshot.phase).toBe("lobby");

    await room.toggleReady(host);
    expect(room.snapshot.phase).toBe("lobby");

    await room.toggleReady(guest);
    expect(room.snapshot.phase).toBe("countdown");
    expect((room.snapshot.countdownEndsAt ?? 0) - Date.now()).toBeLessThan(6_000);

    await room.toggleReady(guest);
    expect(room.snapshot.phase).toBe("lobby");
    expect(room.snapshot.countdownEndsAt).toBeUndefined();
  });

  it("allows the private host to trigger the start countdown manually at the minimum player count", async () => {
    const room = new TestPrivateRoom();
    createdRooms.push(room);
    await room.create();

    const host = { sessionId: "host-client" };
    const guest = { sessionId: "guest-client" };

    await room.joinClient(host, createClaims("host", "private"));
    await room.joinClient(guest, createClaims("guest", "private", { sessionId: "session-guest" }));

    await room.hostStart(host);

    expect(room.snapshot.phase).toBe("countdown");
    expect((room.snapshot.countdownEndsAt ?? 0) - Date.now()).toBeLessThan(6_000);
  });

  it("locks the room and moves active players into round state when the match starts", async () => {
    const room = new TestPublicRoom();
    createdRooms.push(room);
    await room.create();

    await room.joinClient({ sessionId: "c1" }, createClaims("u1", "public"));
    await room.joinClient({ sessionId: "c2" }, createClaims("u2", "public"));

    await room.forceStart();

    expect(room.didLock).toBe(true);
    expect(room.snapshot.phase).toBe("round");
    expect(room.snapshot.currentRoundIndex).toBe(0);
    expect(room.snapshot.players.every((player) => player.status === "playing")).toBe(true);
    expect(room.snapshot.roundEndsAt).toBeGreaterThan(Date.now());
  });
});
