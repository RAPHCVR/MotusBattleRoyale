import { describe, expect, it } from "vitest";

import {
  buildLetterFeedback,
  computeRoundScore,
  createMatchRounds,
  getCutCount,
  getFinalists,
} from "../src/index.ts";

describe("game-core", () => {
  it("handles repeated letters in feedback", () => {
    expect(buildLetterFeedback("BALLE", "LABEL")).toEqual([
      "present",
      "correct",
      "present",
      "present",
      "present",
    ]);
  });

  it("computes scores with bonuses and penalties", () => {
    expect(
      computeRoundScore({
        solved: true,
        attemptsUsed: 2,
        timeRemainingMs: 15_000,
        roundDurationMs: 30_000,
        modifier: "double-down",
        bountyLetter: "A",
        guess: "BANANE",
        clueUsed: true,
      }).total,
    ).toBe(163);
  });

  it("creates 7 rounds", () => {
    expect(createMatchRounds("match-seed")).toHaveLength(7);
  });

  it("uses extended round timers for live play readability", () => {
    expect(
      createMatchRounds("match-seed").map((round) => round.durationMs),
    ).toEqual([120_000, 120_000, 110_000, 100_000, 60_000, 80_000, 70_000]);
  });

  it("cuts 25 percent of players", () => {
    expect(getCutCount(12)).toBe(3);
    expect(getCutCount(4)).toBe(0);
  });

  it("returns finalists by score", () => {
    expect(
      getFinalists([
        { score: 1 },
        { score: 8 },
        { score: 4 },
        { score: 9 },
        { score: 2 },
      ]),
    ).toEqual([{ score: 9 }, { score: 8 }, { score: 4 }, { score: 2 }]);
  });
});
