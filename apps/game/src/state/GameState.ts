import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

import type { GamePhase, PlayerStatus, RoomKind, RoundModifier } from "@motus/protocol";

export class PlayerState extends Schema {
  @type("string") userId = "";
  @type("string") name = "";
  @type("string") avatarSeed = "";
  @type("number") score = 0;
  @type("number") roundScore = 0;
  @type("string") status: PlayerStatus = "queued";
  @type("boolean") connected = true;
  @type("number") attemptsUsed = 0;
  @type("boolean") clueUsed = false;
}

export class MotusRoomState extends Schema {
  @type("string") roomId = "";
  @type("string") roomCode = "";
  @type("string") roomKind: RoomKind = "public";
  @type("string") phase: GamePhase = "queue";
  @type("string") hostUserId = "";
  @type("number") currentRoundIndex = 0;
  @type("number") roundEndsAt = 0;
  @type("number") countdownEndsAt = 0;
  @type("string") modifier: RoundModifier = "standard";
  @type("string") bountyLetter = "";
  @type("string") winnerUserId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(["string"]) finalists = new ArraySchema<string>();
}
