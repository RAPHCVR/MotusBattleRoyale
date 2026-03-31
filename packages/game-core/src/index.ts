import { DEFAULT_ROUND_LENGTHS, normalizeWord } from "@motus/dictionary";
import { pickWordSequence } from "@motus/dictionary/word-bank";
import { FINALISTS_COUNT, TOTAL_ROUNDS, type GuessTileState, type RoundModifier } from "@motus/protocol";

export type LetterFeedback = GuessTileState;

export interface MatchRound {
  index: number;
  length: number;
  modifier: RoundModifier;
  solution: string;
  durationMs: number;
  bountyLetter?: string;
}

export interface ScoreBreakdown {
  solved: boolean;
  solvePoints: number;
  speedBonus: number;
  efficiencyBonus: number;
  bountyBonus: number;
  cluePenalty: number;
  total: number;
}

const ROUND_MODIFIERS: RoundModifier[] = [
  "standard",
  "standard",
  "standard",
  "standard",
  "flash",
  "double-down",
  "bounty-letter"
];

const ROUND_DURATIONS = [120_000, 120_000, 110_000, 100_000, 60_000, 80_000, 70_000] as const;

export function buildLetterFeedback(solutionInput: string, guessInput: string): LetterFeedback[] {
  const solution = normalizeWord(solutionInput);
  const guess = normalizeWord(guessInput);

  if (solution.length !== guess.length) {
    throw new Error("Solution and guess must have the same length.");
  }

  const feedback: LetterFeedback[] = Array.from({ length: solution.length }, () => "absent");
  const remaining = new Map<string, number>();

  for (let index = 0; index < solution.length; index += 1) {
    if (guess[index] === solution[index]) {
      feedback[index] = "correct";
      continue;
    }

    remaining.set(solution[index], (remaining.get(solution[index]) ?? 0) + 1);
  }

  for (let index = 0; index < guess.length; index += 1) {
    if (feedback[index] === "correct") {
      continue;
    }

    const occurrences = remaining.get(guess[index]) ?? 0;

    if (occurrences > 0) {
      feedback[index] = "present";
      remaining.set(guess[index], occurrences - 1);
    }
  }

  return feedback;
}

export function createMatchRounds(seed: string): MatchRound[] {
  const words = pickWordSequence(seed, DEFAULT_ROUND_LENGTHS);

  return words.map((solution, index) => ({
    index,
    length: solution.length,
    modifier: ROUND_MODIFIERS[index] ?? "standard",
    solution,
    durationMs: ROUND_DURATIONS[index] ?? 30_000,
    bountyLetter: index === 6 ? solution[solution.length - 2] : index === 5 ? solution[0] : undefined
  }));
}

export function computeRoundScore(params: {
  solved: boolean;
  attemptsUsed: number;
  timeRemainingMs: number;
  roundDurationMs: number;
  modifier: RoundModifier;
  bountyLetter?: string;
  guess?: string;
  clueUsed?: boolean;
}): ScoreBreakdown {
  const { solved, attemptsUsed, timeRemainingMs, roundDurationMs, modifier, bountyLetter, guess, clueUsed } = params;

  const solvePoints = solved ? 100 : 0;
  const speedRatio = Math.max(0, Math.min(1, timeRemainingMs / roundDurationMs));
  const speedMultiplier = modifier === "double-down" ? 1.35 : 1;
  const speedBonus = solved ? Math.round(100 * speedRatio * speedMultiplier) : 0;

  let efficiencyBonus = 0;

  if (solved) {
    if (attemptsUsed <= 1) efficiencyBonus = 30;
    else if (attemptsUsed === 2) efficiencyBonus = 20;
    else if (attemptsUsed === 3) efficiencyBonus = 10;
  }

  const normalizedGuess = guess ? normalizeWord(guess) : undefined;
  const bountyBonus =
    solved && bountyLetter && normalizedGuess?.includes(bountyLetter)
      ? 15
      : 0;

  const cluePenalty = clueUsed ? 40 : 0;
  const total = solvePoints + speedBonus + efficiencyBonus + bountyBonus - cluePenalty;

  return {
    solved,
    solvePoints,
    speedBonus,
    efficiencyBonus,
    bountyBonus,
    cluePenalty,
    total
  };
}

export function getCutCount(playerCount: number): number {
  if (playerCount <= FINALISTS_COUNT) {
    return 0;
  }

  return Math.max(1, Math.floor(playerCount * 0.25));
}

export function getFinalists<T extends { score: number }>(players: T[]): T[] {
  return [...players].sort((left, right) => right.score - left.score).slice(0, FINALISTS_COUNT);
}

export function assertRoundCount(rounds: MatchRound[]): void {
  if (rounds.length !== TOTAL_ROUNDS) {
    throw new Error(`Expected ${TOTAL_ROUNDS} rounds, received ${rounds.length}.`);
  }
}

export function sanitizeDisplayName(input: string | null | undefined, fallback = "Invite"): string {
  const collapsed = (input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} _-]/gu, "");

  return collapsed.slice(0, 24) || fallback;
}

export function createAvatarSeed(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") || "MOTUS";
  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(index);
    hash |= 0;
  }

  return `motus-${Math.abs(hash).toString(36)}`;
}

export function createGuestName(seed: string): string {
  const syllables = ["Nova", "Flux", "Volt", "Echo", "Lime", "Coda", "Drift", "Pixel"];
  const index = Math.abs(seed.split("").reduce((total, char) => total + char.charCodeAt(0), 0)) % syllables.length;
  const suffix = Math.abs(seed.length * 37 + seed.charCodeAt(0)).toString().slice(-3).padStart(3, "0");

  return `Guest ${syllables[index]} ${suffix}`;
}
