import { describe, expect, it } from "vitest";

import { normalizeWord } from "../src/index.ts";
import { getDictionaryStats, isAllowedGuess, pickWordSequence } from "../src/word-bank.ts";

describe("dictionary", () => {
  it("normalizes accents and punctuation", () => {
    expect(normalizeWord("éclair!")).toBe("ECLAIR");
    expect(normalizeWord("arc-en-ciel")).toBe("ARCENCIEL");
    expect(normalizeWord("cœur")).toBe("COEUR");
  });

  it("checks allowed words by expected length", () => {
    expect(isAllowedGuess("eclair", 6)).toBe(true);
    expect(isAllowedGuess("eclair", 7)).toBe(false);
  });

  it("creates deterministic word sequences", () => {
    expect(pickWordSequence("seed-1")).toEqual(pickWordSequence("seed-1"));
  });

  it("loads a real word bank for 6 and 7-letter rounds", () => {
    const stats = getDictionaryStats();

    expect(stats.solutionCount).toBeGreaterThan(1000);
    expect(stats.allowedCount).toBeGreaterThan(1000);
    expect(stats.lengths).toEqual([
      { length: 6, solutions: expect.any(Number), allowed: expect.any(Number) },
      { length: 7, solutions: expect.any(Number), allowed: expect.any(Number) }
    ]);
    expect(stats.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builtin:curated-solutions",
          role: "solutions",
        }),
        expect.objectContaining({
          id: "file:solutions/lexique-common-top1400.txt",
          role: "solutions",
        }),
        expect.objectContaining({
          id: "package:french-wordlist",
          role: "allowed",
        }),
        expect.objectContaining({
          id: "package:french-badwords-list",
          role: "banned",
        }),
      ]),
    );
  });
});
