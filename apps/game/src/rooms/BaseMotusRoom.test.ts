import type { MatchRound } from "@motus/game-core";
import { describe, expect, it, vi } from "vitest";

import { MotusRoomState, PlayerState } from "../state/GameState.js";
import { PrivateLobbyRoom } from "./PrivateLobbyRoom.js";

function createRuntimePlayer() {
  return {
    matchClueSpent: false,
    roundSolved: false,
    currentRoundScore: 0,
    revealedIndexes: new Set<number>([0]),
    invalidCooldownUntil: 0,
    board: [],
    guesses: [],
    solvedRounds: 0,
    roundRecords: [],
    mmrBefore: 1200,
    mmrAfter: 1200
  };
}

function createRoom() {
  const room = new PrivateLobbyRoom() as any;
  room.state = new MotusRoomState();
  room.clients = [];
  room.clock = {
    setTimeout: vi.fn(() => ({
      clear: vi.fn()
    }))
  };
  room.broadcast = vi.fn();
  room.sendBoardSnapshot = vi.fn();
  room.buildRoomSnapshot = vi.fn(() => ({}));
  room.rounds = Array.from({ length: 7 }, (_, index) => ({
    index,
    length: 6,
    modifier: "standard",
    solution: "MOTUSS",
    durationMs: 1_000
  })) satisfies MatchRound[];
  room.runtimePlayers = new Map();
  return room;
}

function addPlayer(room: any, userId: string, status: string) {
  const player = new PlayerState();
  player.userId = userId;
  player.name = userId;
  player.avatarSeed = userId;
  player.status = status as PlayerState["status"];
  room.state.players.set(userId, player);
  room.runtimePlayers.set(userId, createRuntimePlayer());
  return player;
}

describe("BaseMotusRoom round eligibility", () => {
  it("keeps pre-final spectating players eligible", () => {
    const room = createRoom();
    addPlayer(room, "spectator", "spectating");

    expect(room.isEligibleForRound("spectator", 4)).toBe(true);
    expect(room.isEligibleForRound("spectator", 5)).toBe(true);
    expect(room.isEligibleForRound("spectator", 6)).toBe(false);

    room.state.finalists.push("spectator");
    expect(room.isEligibleForRound("spectator", 6)).toBe(true);
  });

  it("reactivates spectating players on the next playable round without reviving eliminated players", () => {
    const room = createRoom();
    const spectator = addPlayer(room, "spectator", "spectating");
    const eliminated = addPlayer(room, "eliminated", "eliminated");

    room.startRound(4);

    expect(spectator.status).toBe("playing");
    expect(eliminated.status).toBe("eliminated");
  });

  it("does not eliminate anyone on the quarter cut when only three players remain", () => {
    const room = createRoom();
    const alpha = addPlayer(room, "alpha", "playing");
    const bravo = addPlayer(room, "bravo", "playing");
    const charlie = addPlayer(room, "charlie", "playing");

    alpha.score = 240;
    bravo.score = 180;
    charlie.score = 120;

    room.applyQuarterCut();

    expect(alpha.status).toBe("playing");
    expect(bravo.status).toBe("playing");
    expect(charlie.status).toBe("playing");
  });

  it("keeps every remaining player as a finalist when the lobby is already under the finalist cap", () => {
    const room = createRoom();
    const alpha = addPlayer(room, "alpha", "playing");
    const bravo = addPlayer(room, "bravo", "playing");
    const charlie = addPlayer(room, "charlie", "playing");

    alpha.score = 240;
    bravo.score = 180;
    charlie.score = 120;

    room.selectFinalists();

    expect(Array.from(room.state.finalists)).toEqual(["alpha", "bravo", "charlie"]);
    expect(alpha.status).toBe("playing");
    expect(bravo.status).toBe("playing");
    expect(charlie.status).toBe("playing");
  });
});
