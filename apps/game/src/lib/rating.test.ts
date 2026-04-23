import { describe, expect, it } from "vitest";

import {
  computeLobbyAnchorMmr,
  computeMatchMmrDeltas,
} from "./rating.js";

describe("rating helpers", () => {
  it("keeps match deltas zero-sum while rewarding better placements", () => {
    const deltas = computeMatchMmrDeltas([
      { userId: "alpha", placement: 1, mmrBefore: 1_200 },
      { userId: "bravo", placement: 2, mmrBefore: 1_200 },
      { userId: "charlie", placement: 3, mmrBefore: 1_200 },
      { userId: "delta", placement: 4, mmrBefore: 1_200 },
    ]);

    const alpha = deltas.get("alpha") ?? 0;
    const bravo = deltas.get("bravo") ?? 0;
    const charlie = deltas.get("charlie") ?? 0;
    const delta = deltas.get("delta") ?? 0;

    expect(alpha).toBeGreaterThan(bravo);
    expect(bravo).toBeGreaterThanOrEqual(charlie);
    expect(charlie).toBeGreaterThan(delta);
    expect(alpha + bravo + charlie + delta).toBe(0);
  });

  it("rewards an upset more than a favorite win", () => {
    const upset = computeMatchMmrDeltas([
      { userId: "underdog", placement: 1, mmrBefore: 1_000 },
      { userId: "favorite", placement: 2, mmrBefore: 1_400 },
    ]);
    const expected = computeMatchMmrDeltas([
      { userId: "favorite", placement: 1, mmrBefore: 1_400 },
      { userId: "underdog", placement: 2, mmrBefore: 1_000 },
    ]);

    expect((upset.get("underdog") ?? 0) - (expected.get("favorite") ?? 0)).toBeGreaterThan(0);
    expect((upset.get("favorite") ?? 0) - (expected.get("underdog") ?? 0)).toBeLessThan(0);
  });

  it("uses the lobby median as matchmaking anchor", () => {
    expect(computeLobbyAnchorMmr([1_200, 1_200, 1_600])).toBe(1_200);
    expect(computeLobbyAnchorMmr([1_150, 1_250, 1_350, 1_450])).toBe(1_300);
  });
});
