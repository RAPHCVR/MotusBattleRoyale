import { Delayed, Room, type Client as ColyseusClient } from "colyseus";
import { nanoid } from "nanoid";

import { normalizeWord } from "@motus/dictionary";
import { isAllowedGuess } from "@motus/dictionary/word-bank";
import {
  buildLetterFeedback,
  computeRoundScore,
  createMatchRounds,
  getCutCount,
  getFinalists
} from "@motus/game-core";
import {
  INVALID_GUESS_COOLDOWN_MS,
  MAX_ATTEMPTS_PER_ROUND,
  PRIVATE_MIN_PLAYERS,
  PRIVATE_RECONNECTION_WINDOW_SECONDS,
  PUBLIC_MIN_PLAYERS,
  PUBLIC_READY_DELAY_MS,
  ROOM_FULL_COUNTDOWN_MS,
  ROOM_MAX_PLAYERS,
  type BoardRow,
  type BoardSnapshot,
  type GameTokenClaims,
  type GuessResult,
  type PlayerSummary,
  type RoomKind,
  type RoomSnapshot
} from "@motus/protocol";

import { verifyGameToken } from "../lib/auth.js";
import {
  computeLobbyAnchorMmr,
  computeMatchMmrDeltas,
  DEFAULT_MMR,
} from "../lib/rating.js";
import { persistMatchResult, type PersistedPlayerResult, type PersistedRoundRecord } from "../lib/store.js";
import { MotusRoomState, PlayerState } from "../state/GameState.js";

type GameClient = ColyseusClient & {
  auth?: GameTokenClaims;
};

type RuntimePlayer = {
  matchClueSpent: boolean;
  roundSolved: boolean;
  currentRoundScore: number;
  revealedIndexes: Set<number>;
  invalidCooldownUntil: number;
  board: BoardRow[];
  guesses: string[];
  solvedRounds: number;
  roundRecords: PersistedRoundRecord[];
  mmrBefore: number;
  mmrAfter: number;
};

export abstract class BaseMotusRoom extends Room<{ state: MotusRoomState }> {
  protected abstract readonly roomKind: RoomKind;

  maxClients = ROOM_MAX_PLAYERS;
  patchRate = 80;
  maxMessagesPerSecond = 24;
  seatReservationTimeout = PRIVATE_RECONNECTION_WINDOW_SECONDS;

  private countdownTimer?: Delayed;
  private roundTimer?: Delayed;
  private transitionTimer?: Delayed;
  private readonly runtimePlayers = new Map<string, RuntimePlayer>();
  private readonly sessionToUserId = new Map<string, string>();
  private startedAt = 0;
  private matchSeed = "";
  private matchStarted = false;
  private roomCode = "";
  private anchorMmr = DEFAULT_MMR;
  private rounds = createMatchRounds("bootstrap-seed");

  async onCreate(options: { hostUserId?: string; roomCode?: string; seed?: string; anchorMmr?: number }): Promise<void> {
    this.state = new MotusRoomState();
    this.state.roomId = this.roomId;
    this.state.roomKind = this.roomKind;
    this.state.phase = this.roomKind === "public" ? "queue" : "lobby";
    this.state.hostUserId = options.hostUserId ?? "";
    this.roomCode = options.roomCode ?? "";
    this.anchorMmr = options.anchorMmr ?? 1200;
    this.state.roomCode = this.roomCode;
    this.matchSeed = options.seed ?? nanoid(12);
    this.rounds = createMatchRounds(this.matchSeed);

    await this.setPrivate(this.roomKind === "private");
    await this.syncMatchmaking();

    this.onMessage("guess", (client, payload) => {
      void this.handleGuess(client, payload as { value?: string });
    });

    this.onMessage("use_clue", (client) => {
      void this.handleUseClue(client);
    });

    this.onMessage("set_ready", (client) => {
      void this.handleReadyToggle(client);
    });

    this.onMessage("start_match", (client) => {
      void this.handleHostStart(client);
    });

    this.onMessage("request_sync", (client) => {
      this.sendBoardSnapshot(client);
      this.send(client, "phase:update", this.buildRoomSnapshot());
    });
  }

  static async onAuth(token: string): Promise<GameTokenClaims> {
    return verifyGameToken(token);
  }

  async onJoin(client: GameClient, _: unknown, auth?: GameTokenClaims): Promise<void> {
    const claims = auth ?? client.auth;

    if (!claims) {
      throw new Error("Missing verified auth payload.");
    }

    if (claims.roomKind !== this.roomKind) {
      throw new Error("Wrong room kind.");
    }

    if (this.roomKind === "private" && claims.roomCode !== this.roomCode) {
      throw new Error("Wrong room code.");
    }

    this.sessionToUserId.set(client.sessionId, claims.sub);

    const existing = this.state.players.get(claims.sub);

    if (existing) {
      existing.connected = true;
      this.sendBoardSnapshot(client);
      this.send(client, "phase:update", this.buildRoomSnapshot());
      return;
    }

    const player = new PlayerState();
    player.userId = claims.sub;
    player.name = claims.name;
    player.avatarSeed = claims.avatarSeed;
    player.status = "queued";
    player.connected = true;
    this.state.players.set(claims.sub, player);

    this.runtimePlayers.set(claims.sub, {
      matchClueSpent: false,
      roundSolved: false,
      currentRoundScore: 0,
      revealedIndexes: new Set<number>([0]),
      invalidCooldownUntil: 0,
      board: [],
      guesses: [],
      solvedRounds: 0,
      roundRecords: [],
      mmrBefore: claims.mmr,
      mmrAfter: claims.mmr
    });

    if (!this.state.hostUserId) {
      this.state.hostUserId = claims.sub;
    }

    this.sendBoardSnapshot(client);
    await this.afterRosterChange();
  }

  async onLeave(client: GameClient, _code?: number): Promise<void> {
    const userId = this.sessionToUserId.get(client.sessionId);

    if (!userId) {
      return;
    }

    this.sessionToUserId.delete(client.sessionId);

    if (!this.matchStarted) {
      this.runtimePlayers.delete(userId);
      this.state.players.delete(userId);

      if (this.state.hostUserId === userId) {
        this.state.hostUserId = this.sortedPlayers()[0]?.userId ?? "";
      }

      await this.afterRosterChange();
      return;
    }

    const player = this.state.players.get(userId);

    if (!player) {
      return;
    }

    player.connected = false;
    this.broadcast("phase:update", this.buildRoomSnapshot());

    try {
      const reconnected = await this.allowReconnection(client, PRIVATE_RECONNECTION_WINDOW_SECONDS);
      this.sessionToUserId.set(reconnected.sessionId, userId);
      player.connected = true;
      this.sendBoardSnapshot(reconnected);
      this.send(reconnected, "phase:update", this.buildRoomSnapshot());
    } catch {
      if (player.status !== "eliminated" && player.status !== "spectating") {
        player.status = "left";
      }

      this.broadcast("phase:update", this.buildRoomSnapshot());
      this.maybeEndRoundEarly();
    }
  }

  protected async afterRosterChange(): Promise<void> {
    this.refreshAnchorMmr();

    if (!this.matchStarted) {
      this.ensurePreMatchPhase();
      this.updateAutoCountdown();
    }

    await this.syncMatchmaking();
    this.broadcast("phase:update", this.buildRoomSnapshot());
  }

  protected ensurePreMatchPhase(): void {
    if (this.matchStarted) {
      return;
    }

    if (!this.countdownTimer) {
      this.state.phase = this.roomKind === "public" ? "queue" : "lobby";
      this.state.countdownEndsAt = 0;
    }
  }

  protected updateAutoCountdown(): void {
    if (this.matchStarted) {
      return;
    }

    const totalPlayers = this.state.players.size;
    const minPlayers = this.roomKind === "public" ? PUBLIC_MIN_PLAYERS : PRIVATE_MIN_PLAYERS;

    if (totalPlayers < minPlayers) {
      this.cancelCountdown();
      return;
    }

    if (totalPlayers >= ROOM_MAX_PLAYERS) {
      this.scheduleCountdown(ROOM_FULL_COUNTDOWN_MS);
      return;
    }

    if (this.roomKind === "public") {
      this.scheduleCountdown(PUBLIC_READY_DELAY_MS);
      return;
    }

    if (this.areAllPrivatePlayersReady()) {
      this.scheduleCountdown(ROOM_FULL_COUNTDOWN_MS);
      return;
    }

    this.cancelCountdown();
  }

  protected scheduleCountdown(durationMs: number): void {
    const desiredEndsAt = Date.now() + durationMs;

    if (this.state.countdownEndsAt && this.state.countdownEndsAt <= desiredEndsAt) {
      return;
    }

    this.countdownTimer?.clear();
    this.state.phase = "countdown";
    this.state.countdownEndsAt = desiredEndsAt;
    this.broadcast("phase:update", this.buildRoomSnapshot());

    this.countdownTimer = this.clock.setTimeout(() => {
      void this.tryStartMatch();
    }, durationMs);
  }

  protected cancelCountdown(): void {
    this.countdownTimer?.clear();
    this.countdownTimer = undefined;
    this.state.countdownEndsAt = 0;

    if (!this.matchStarted) {
      this.state.phase = this.roomKind === "public" ? "queue" : "lobby";
    }
  }

  protected async tryStartMatch(): Promise<void> {
    const minPlayers = this.roomKind === "public" ? PUBLIC_MIN_PLAYERS : PRIVATE_MIN_PLAYERS;

    if (this.matchStarted || this.state.players.size < minPlayers) {
      this.cancelCountdown();
      this.broadcast("phase:update", this.buildRoomSnapshot());
      return;
    }

    this.matchStarted = true;
    this.startedAt = Date.now();
    this.cancelCountdown();
    await this.lock();
    this.startRound(0);
  }

  protected startRound(roundIndex: number): void {
    const round = this.rounds[roundIndex];

    if (!round) {
      void this.finishMatch();
      return;
    }

    this.transitionTimer?.clear();
    this.roundTimer?.clear();

    this.state.phase = "round";
    this.state.currentRoundIndex = roundIndex;
    this.state.modifier = round.modifier;
    this.state.bountyLetter = round.bountyLetter ?? "";
    this.state.roundEndsAt = Date.now() + round.durationMs;
    this.state.countdownEndsAt = 0;

    for (const player of this.state.players.values()) {
      const runtime = this.runtimePlayers.get(player.userId);

      if (!runtime) {
        continue;
      }

      runtime.roundSolved = false;
      runtime.currentRoundScore = 0;
      runtime.invalidCooldownUntil = 0;
      runtime.board = [];
      runtime.guesses = [];
      runtime.revealedIndexes = new Set<number>([0]);

      if (!this.isEligibleForRound(player.userId, roundIndex)) {
        if (player.status !== "left" && player.status !== "eliminated") {
          player.status = "spectating";
        }
        player.attemptsUsed = 0;
        player.roundScore = 0;
        continue;
      }

      player.attemptsUsed = 0;
      player.roundScore = 0;
      player.status = "playing";
    }

    this.broadcast("phase:update", this.buildRoomSnapshot());

    for (const client of this.clients) {
      this.sendBoardSnapshot(client);
    }

    this.roundTimer = this.clock.setTimeout(() => {
      void this.completeRound();
    }, round.durationMs);
  }

  protected isEligibleForRound(userId: string, roundIndex: number): boolean {
    const player = this.state.players.get(userId);

    if (!player || player.status === "left" || player.status === "eliminated") {
      return false;
    }

    if (roundIndex < 6) {
      return true;
    }

    return [...this.state.finalists].includes(userId);
  }

  protected async completeRound(): Promise<void> {
    this.roundTimer?.clear();
    this.roundTimer = undefined;
    this.state.roundEndsAt = 0;

    const roundIndex = this.state.currentRoundIndex;
    const round = this.rounds[roundIndex];

    for (const player of this.state.players.values()) {
      const runtime = this.runtimePlayers.get(player.userId);

      if (!runtime || player.status === "left" || !this.isEligibleForRound(player.userId, roundIndex)) {
        continue;
      }

      runtime.roundRecords.push({
        roundIndex,
        solution: round.solution,
        solved: runtime.roundSolved,
        attemptsUsed: player.attemptsUsed,
        scoreDelta: runtime.currentRoundScore,
        modifier: round.modifier,
        bountyLetter: round.bountyLetter,
        guesses: [...runtime.guesses]
      });

      if (runtime.roundSolved) {
        runtime.solvedRounds += 1;
      }
    }

    if (roundIndex === 3) {
      this.applyQuarterCut();
    }

    if (roundIndex === 5) {
      this.selectFinalists();
    }

    if (roundIndex >= this.rounds.length - 1) {
      await this.finishMatch();
      return;
    }

    this.state.phase = "intermission";
    this.state.countdownEndsAt = Date.now() + 4_000;

    for (const client of this.clients) {
      this.sendBoardSnapshot(client);
    }

    this.broadcast("phase:update", this.buildRoomSnapshot());

    this.transitionTimer = this.clock.setTimeout(() => {
      this.startRound(roundIndex + 1);
    }, 4_000);
  }

  protected applyQuarterCut(): void {
    const contenders = this.sortedPlayers().filter((player) => player.status !== "left" && player.status !== "eliminated");
    const cutCount = getCutCount(contenders.length);

    if (cutCount <= 0) {
      return;
    }

    for (const player of contenders.slice(-cutCount)) {
      player.status = "eliminated";
    }
  }

  protected selectFinalists(): void {
    const active = this.sortedPlayers().filter((player) => player.status !== "left" && player.status !== "eliminated");
    const finalists = getFinalists(active).map((player) => player.userId);
    const finalistsSet = new Set(finalists);

    this.state.finalists.splice(0, this.state.finalists.length);

    for (const userId of finalists) {
      this.state.finalists.push(userId);
    }

    for (const player of this.state.players.values()) {
      if (player.status === "left") {
        continue;
      }

      if (!finalistsSet.has(player.userId)) {
        player.status = "eliminated";
      }
    }
  }

  protected async finishMatch(): Promise<void> {
    this.transitionTimer?.clear();
    this.roundTimer?.clear();
    this.state.phase = "results";
    this.state.roundEndsAt = 0;
    this.state.countdownEndsAt = 0;

    const standings = this.sortedPlayers();
    const winner = standings[0];
    const mmrDeltas = computeMatchMmrDeltas(
      standings.map((player, index) => ({
        userId: player.userId,
        placement: index + 1,
        mmrBefore:
          this.runtimePlayers.get(player.userId)?.mmrBefore ?? DEFAULT_MMR,
      })),
    );

    if (winner) {
      this.state.winnerUserId = winner.userId;
    }

    const results: PersistedPlayerResult[] = standings.map((player, index) => {
      const runtime = this.runtimePlayers.get(player.userId);
      const mmrDelta = mmrDeltas.get(player.userId) ?? 0;
      const mmrBefore = runtime?.mmrBefore ?? DEFAULT_MMR;
      const mmrAfter = mmrBefore + mmrDelta;

      if (runtime) {
        runtime.mmrAfter = mmrAfter;
      }

      return {
        userId: player.userId,
        displayName: player.name,
        avatarSeed: player.avatarSeed,
        placement: index + 1,
        score: player.score,
        clueUsed: player.clueUsed,
        solvedRounds: runtime?.solvedRounds ?? 0,
        mmrBefore,
        mmrAfter,
        roundRecords: runtime?.roundRecords ?? []
      };
    });

    await persistMatchResult({
      matchId: this.roomId,
      roomKind: this.roomKind,
      roomCode: this.roomCode || undefined,
      seed: this.matchSeed,
      winnerUserId: winner?.userId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      metadata: {
        players: standings.length,
        finalists: [...this.state.finalists]
      },
      players: results
    });

    for (const client of this.clients) {
      this.sendBoardSnapshot(client);
    }

    this.broadcast("phase:update", this.buildRoomSnapshot());
    this.broadcast("match:summary", {
      roomId: this.roomId,
      roomKind: this.roomKind,
      winnerUserId: winner?.userId,
      players: results.map((player) => ({
        userId: player.userId,
        name: player.displayName,
        avatarSeed: player.avatarSeed,
        score: player.score,
        roundScore: this.state.players.get(player.userId)?.roundScore ?? 0,
        status: this.state.players.get(player.userId)?.status ?? "left",
        connected: this.state.players.get(player.userId)?.connected ?? false,
        attemptsUsed: this.state.players.get(player.userId)?.attemptsUsed ?? 0,
        clueUsed: player.clueUsed,
        placement: player.placement
      }))
    });

    this.transitionTimer = this.clock.setTimeout(() => {
      void this.disconnect();
    }, 25_000);
  }

  protected async handleGuess(client: GameClient, payload: { value?: string }): Promise<void> {
    if (this.state.phase !== "round") {
      return;
    }

    const userId = this.sessionToUserId.get(client.sessionId);
    const player = userId ? this.state.players.get(userId) : undefined;
    const runtime = userId ? this.runtimePlayers.get(userId) : undefined;
    const round = this.rounds[this.state.currentRoundIndex];

    if (!player || !runtime || !round || player.status !== "playing") {
      return;
    }

    if (Date.now() < runtime.invalidCooldownUntil || runtime.board.length >= MAX_ATTEMPTS_PER_ROUND) {
      return;
    }

    const normalizedGuess = normalizeWord(payload.value ?? "");
    const isValid = isAllowedGuess(normalizedGuess, round.length);

    if (!isValid) {
      runtime.invalidCooldownUntil = Date.now() + INVALID_GUESS_COOLDOWN_MS;
      const invalidResult: GuessResult = {
        guess: normalizedGuess,
        tiles: Array.from({ length: round.length }, () => "pending"),
        isValid: false,
        solved: false,
        attemptsUsed: player.attemptsUsed,
        scoreDelta: 0,
        error: "Mot introuvable dans le dictionnaire."
      };

      this.send(client, "guess:result", invalidResult);
      return;
    }

    const tiles = buildLetterFeedback(round.solution, normalizedGuess);
    const solved = tiles.every((tile) => tile === "correct");
    const bountyHit = Boolean(round.bountyLetter && normalizedGuess.includes(round.bountyLetter));

    player.attemptsUsed += 1;
    runtime.board.push({ guess: normalizedGuess, tiles });
    runtime.guesses.push(normalizedGuess);

    let scoreDelta = 0;

    if (solved) {
      runtime.roundSolved = true;
      player.status = "solved";

      const score = computeRoundScore({
        solved: true,
        attemptsUsed: player.attemptsUsed,
        timeRemainingMs: Math.max(0, this.state.roundEndsAt - Date.now()),
        roundDurationMs: round.durationMs,
        modifier: round.modifier,
        bountyLetter: round.bountyLetter,
        guess: normalizedGuess,
        clueUsed: runtime.matchClueSpent
      });

      runtime.currentRoundScore = score.total;
      player.roundScore = score.total;
      player.score += score.total;
      scoreDelta = score.total;
    }

    const result: GuessResult = {
      guess: normalizedGuess,
      tiles,
      isValid: true,
      solved,
      attemptsUsed: player.attemptsUsed,
      scoreDelta,
      bountyHit
    };

    this.send(client, "guess:result", result);
    this.sendBoardSnapshot(client);
    this.broadcast("phase:update", this.buildRoomSnapshot());
    this.maybeEndRoundEarly();
  }

  protected async handleUseClue(client: GameClient): Promise<void> {
    if (this.state.phase !== "round" || this.state.currentRoundIndex < 4) {
      return;
    }

    const userId = this.sessionToUserId.get(client.sessionId);
    if (!userId) {
      return;
    }
    const player = userId ? this.state.players.get(userId) : undefined;
    const runtime = userId ? this.runtimePlayers.get(userId) : undefined;
    const round = this.rounds[this.state.currentRoundIndex];

    if (!player || !runtime || !round || runtime.matchClueSpent || player.status !== "playing") {
      return;
    }

    const availableIndexes = Array.from({ length: round.length }, (_, index) => index).filter(
      (index) => !runtime.revealedIndexes.has(index)
    );

    if (!availableIndexes.length) {
      return;
    }

    const chosenIndex = availableIndexes[(userId.length + this.state.currentRoundIndex) % availableIndexes.length];
    runtime.matchClueSpent = true;
    runtime.revealedIndexes.add(chosenIndex);
    player.clueUsed = true;

    this.send(client, "guess:result", {
      guess: "",
      tiles: [],
      isValid: true,
      solved: false,
      attemptsUsed: player.attemptsUsed,
      scoreDelta: 0,
      clueRevealedIndex: chosenIndex
    } satisfies GuessResult);

    this.sendBoardSnapshot(client);
    this.broadcast("phase:update", this.buildRoomSnapshot());
  }

  protected async handleReadyToggle(client: GameClient): Promise<void> {
    if (this.roomKind !== "private" || this.matchStarted) {
      return;
    }

    const userId = this.sessionToUserId.get(client.sessionId);
    const player = userId ? this.state.players.get(userId) : undefined;

    if (!player) {
      return;
    }

    player.status = player.status === "ready" ? "queued" : "ready";
    this.updateAutoCountdown();
    this.broadcast("phase:update", this.buildRoomSnapshot());
  }

  protected async handleHostStart(client: GameClient): Promise<void> {
    if (this.roomKind !== "private" || this.matchStarted) {
      return;
    }

    const userId = this.sessionToUserId.get(client.sessionId);

    if (!userId || userId !== this.state.hostUserId || this.state.players.size < PRIVATE_MIN_PLAYERS) {
      return;
    }

    this.scheduleCountdown(ROOM_FULL_COUNTDOWN_MS);
  }

  protected maybeEndRoundEarly(): void {
    if (this.state.phase !== "round") {
      return;
    }

    const everybodyDone = this.sortedPlayers()
      .filter((player) => this.isEligibleForRound(player.userId, this.state.currentRoundIndex))
      .every((player) => {
        const runtime = this.runtimePlayers.get(player.userId);

        return (
          player.status !== "playing" ||
          Boolean(runtime && (runtime.roundSolved || runtime.board.length >= MAX_ATTEMPTS_PER_ROUND))
        );
      });

    if (everybodyDone) {
      this.roundTimer?.clear();
      this.roundTimer = this.clock.setTimeout(() => {
        void this.completeRound();
      }, 1_200);
    }
  }

  protected areAllPrivatePlayersReady(): boolean {
    if (this.roomKind !== "private") {
      return false;
    }

    const activePlayers = this.sortedPlayers().filter((player) => player.status !== "left");

    return activePlayers.length >= PRIVATE_MIN_PLAYERS && activePlayers.every((player) => player.status === "ready");
  }

  protected sendBoardSnapshot(client: GameClient): void {
    const userId = this.sessionToUserId.get(client.sessionId);
    const player = userId ? this.state.players.get(userId) : undefined;
    const runtime = userId ? this.runtimePlayers.get(userId) : undefined;
    const round = this.rounds[this.state.currentRoundIndex];

    if (!player || !runtime || !round) {
      return;
    }

    const snapshot: BoardSnapshot = {
      roundIndex: this.state.currentRoundIndex,
      wordLength: round.length,
      rows: runtime.board,
      revealedIndexes: [...runtime.revealedIndexes].sort((left, right) => left - right),
      hintLetters: Array.from({ length: round.length }, (_, index) =>
        runtime.revealedIndexes.has(index) ? round.solution[index] : ""
      ),
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS_PER_ROUND - runtime.board.length),
      clueUsed: runtime.matchClueSpent,
      canUseClue:
        this.state.phase === "round" &&
        this.state.currentRoundIndex >= 4 &&
        !runtime.matchClueSpent &&
        player.status === "playing",
      roundResolved: this.state.phase === "intermission" || this.state.phase === "results",
      roundSolved: runtime.roundSolved,
      roundScore: runtime.currentRoundScore,
      solution: this.state.phase === "intermission" || this.state.phase === "results" ? round.solution : undefined
    };

    this.send(client, "board:snapshot", snapshot);
  }

  protected sortedPlayers(): PlayerState[] {
    return [...this.state.players.values()].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.roundScore !== left.roundScore) {
        return right.roundScore - left.roundScore;
      }

      return left.name.localeCompare(right.name, "fr");
    });
  }

  protected buildRoomSnapshot(): RoomSnapshot {
    const players: PlayerSummary[] = this.sortedPlayers().map((player) => ({
      userId: player.userId,
      name: player.name,
      avatarSeed: player.avatarSeed,
      score: player.score,
      roundScore: player.roundScore,
      status: player.status,
      connected: player.connected,
      attemptsUsed: player.attemptsUsed,
      clueUsed: player.clueUsed
    }));

    return {
      roomId: this.roomId,
      roomCode: this.roomCode || undefined,
      roomKind: this.roomKind,
      phase: this.state.phase,
      hostUserId: this.state.hostUserId || undefined,
      currentRoundIndex: this.state.currentRoundIndex,
      roundEndsAt: this.state.roundEndsAt || undefined,
      countdownEndsAt: this.state.countdownEndsAt || undefined,
      modifier: this.state.modifier || undefined,
      bountyLetter: this.state.bountyLetter || undefined,
      players,
      activePlayerCount: players.filter((player) => !["eliminated", "left", "spectating"].includes(player.status)).length,
      finalistsCount: this.state.finalists.length
    };
  }

  protected async syncMatchmaking(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        roomCode: this.roomCode || undefined,
        phase: this.state.phase,
        players: this.state.players.size,
        hostUserId: this.state.hostUserId || undefined,
        anchorMmr: this.anchorMmr
      },
      private: this.roomKind === "private",
      maxClients: ROOM_MAX_PLAYERS
    });
  }

  private refreshAnchorMmr() {
    const currentRatings = [...this.state.players.values()]
      .filter((player) => player.status !== "left")
      .map((player) => this.runtimePlayers.get(player.userId)?.mmrBefore)
      .filter((mmr): mmr is number => typeof mmr === "number");

    this.anchorMmr = computeLobbyAnchorMmr(currentRatings, this.anchorMmr);
  }
}
