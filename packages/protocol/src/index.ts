import { z } from "zod";

export const PUBLIC_MIN_PLAYERS = 2;
export const PRIVATE_MIN_PLAYERS = 2;
export const ROOM_MAX_PLAYERS = 12;
export const TOTAL_ROUNDS = 7;
export const FINALISTS_COUNT = 4;
export const INVALID_GUESS_COOLDOWN_MS = 1_500;
export const PUBLIC_READY_DELAY_MS = 20_000;
export const ROOM_FULL_COUNTDOWN_MS = 5_000;
export const PRIVATE_RECONNECTION_WINDOW_SECONDS = 20;
export const MAX_ATTEMPTS_PER_ROUND = 6;

export const roundModifierSchema = z.enum(["standard", "flash", "double-down", "bounty-letter", "fog"]);
export type RoundModifier = z.infer<typeof roundModifierSchema>;

export const roomKindSchema = z.enum(["public", "private"]);
export type RoomKind = z.infer<typeof roomKindSchema>;

export const gamePhaseSchema = z.enum(["queue", "lobby", "countdown", "round", "intermission", "results"]);
export type GamePhase = z.infer<typeof gamePhaseSchema>;

export const playerStatusSchema = z.enum(["queued", "ready", "playing", "solved", "eliminated", "spectating", "left"]);
export type PlayerStatus = z.infer<typeof playerStatusSchema>;

export const guessTileStateSchema = z.enum(["correct", "present", "absent", "pending"]);
export type GuessTileState = z.infer<typeof guessTileStateSchema>;

export const playerSummarySchema = z.object({
  userId: z.string(),
  name: z.string(),
  avatarSeed: z.string(),
  score: z.number(),
  roundScore: z.number(),
  status: playerStatusSchema,
  connected: z.boolean(),
  attemptsUsed: z.number().int().nonnegative(),
  clueUsed: z.boolean()
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const boardRowSchema = z.object({
  guess: z.string(),
  tiles: z.array(guessTileStateSchema)
});
export type BoardRow = z.infer<typeof boardRowSchema>;

export const boardSnapshotSchema = z.object({
  roundIndex: z.number().int().min(0),
  wordLength: z.number().int().min(1),
  rows: z.array(boardRowSchema),
  revealedIndexes: z.array(z.number().int().min(0)),
  hintLetters: z.array(z.string()),
  attemptsRemaining: z.number().int().min(0),
  clueUsed: z.boolean(),
  canUseClue: z.boolean(),
  roundResolved: z.boolean(),
  roundSolved: z.boolean(),
  roundScore: z.number(),
  solution: z.string().optional()
});
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

export const matchSummarySchema = z.object({
  roomId: z.string(),
  roomKind: roomKindSchema,
  winnerUserId: z.string().optional(),
  players: z.array(
    playerSummarySchema.extend({
      placement: z.number().int().positive()
    })
  )
});
export type MatchSummary = z.infer<typeof matchSummarySchema>;

export const seatReservationSchema = z.object({
  name: z.string(),
  sessionId: z.string(),
  roomId: z.string(),
  publicAddress: z.string().optional(),
  processId: z.string().optional(),
  reconnectionToken: z.string().optional(),
  devMode: z.boolean().optional()
});
export type SeatReservation = z.infer<typeof seatReservationSchema>;

export const ticketBundleSchema = z.object({
  ticketType: roomKindSchema,
  token: z.string(),
  reservation: seatReservationSchema,
  roomCode: z.string().optional(),
  roomId: z.string(),
  wsEndpoint: z.string()
});
export type TicketBundle = z.infer<typeof ticketBundleSchema>;

export const gameTokenClaimsSchema = z.object({
  sub: z.string(),
  sessionId: z.string(),
  name: z.string(),
  avatarSeed: z.string(),
  mmr: z.number().int().nonnegative(),
  isAnonymous: z.boolean(),
  roomKind: roomKindSchema,
  roomCode: z.string().optional(),
  ticketId: z.string(),
  iat: z.number().int(),
  exp: z.number().int()
});
export type GameTokenClaims = z.infer<typeof gameTokenClaimsSchema>;

export const publicTicketRequestSchema = z.object({
  displayName: z.string().min(1).max(24).optional()
});
export type PublicTicketRequest = z.infer<typeof publicTicketRequestSchema>;

export const privateRoomCreateRequestSchema = z.object({
  displayName: z.string().min(1).max(24).optional()
});
export type PrivateRoomCreateRequest = z.infer<typeof privateRoomCreateRequestSchema>;

export const privateRoomJoinRequestSchema = z.object({
  roomCode: z.string().min(4).max(8)
});
export type PrivateRoomJoinRequest = z.infer<typeof privateRoomJoinRequestSchema>;

export const startMatchRequestSchema = z.object({
  roomId: z.string()
});

export const guessRequestSchema = z.object({
  value: z.string().min(1).max(12)
});
export type GuessRequest = z.infer<typeof guessRequestSchema>;

export const clueRequestSchema = z.object({
  roundIndex: z.number().int().min(0).max(TOTAL_ROUNDS - 1)
});
export type ClueRequest = z.infer<typeof clueRequestSchema>;

export const guessResultSchema = z.object({
  guess: z.string(),
  tiles: z.array(guessTileStateSchema),
  isValid: z.boolean(),
  solved: z.boolean(),
  attemptsUsed: z.number().int().nonnegative(),
  scoreDelta: z.number(),
  error: z.string().optional(),
  bountyHit: z.boolean().optional(),
  clueRevealedIndex: z.number().int().min(0).optional()
});
export type GuessResult = z.infer<typeof guessResultSchema>;

export const roomSnapshotSchema = z.object({
  roomId: z.string(),
  roomCode: z.string().optional(),
  roomKind: roomKindSchema,
  phase: gamePhaseSchema,
  hostUserId: z.string().optional(),
  currentRoundIndex: z.number().int().min(0),
  roundEndsAt: z.number().int().optional(),
  countdownEndsAt: z.number().int().optional(),
  modifier: roundModifierSchema.optional(),
  bountyLetter: z.string().optional(),
  players: z.array(playerSummarySchema),
  activePlayerCount: z.number().int().min(0),
  finalistsCount: z.number().int().min(0)
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const clientRoomEventSchema = z.enum(["guess", "use_clue", "set_ready", "start_match", "request_sync"]);
export type ClientRoomEvent = z.infer<typeof clientRoomEventSchema>;

export const serverRoomEventSchema = z.enum([
  "guess:result",
  "board:snapshot",
  "phase:update",
  "toast",
  "match:summary"
]);
export type ServerRoomEvent = z.infer<typeof serverRoomEventSchema>;
