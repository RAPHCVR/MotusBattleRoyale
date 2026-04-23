import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
  query: vi.fn(),
  mergeLocalDevPlayerProfiles: vi.fn(),
}));

vi.mock("./db", () => ({
  pgPool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

vi.mock("./env", () => ({
  env: {
    LOCAL_STORAGE_FALLBACK_ENABLED: false,
  },
}));

vi.mock("./local-dev-store", () => ({
  getLocalDevLeaderboard: vi.fn(),
  isLocalDatabaseConnectionError: vi.fn(() => false),
  mergeLocalDevPlayerProfiles: mocks.mergeLocalDevPlayerProfiles,
  upsertLocalDevPlayerProfile: vi.fn(),
}));

describe("player profile migration", () => {
  afterEach(() => {
    mocks.connect.mockReset();
    mocks.poolQuery.mockReset();
    mocks.release.mockReset();
    mocks.query.mockReset();
    mocks.mergeLocalDevPlayerProfiles.mockReset();
    vi.resetModules();
  });

  it("migrates round history and merges match rows safely", async () => {
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockResolvedValue({ rows: [] });

    const { migrateAnonymousProfile } = await import("./player-profile");
    await migrateAnonymousProfile("guest-user", "account-user");

    const sqlStatements = mocks.query.mock.calls.map((call) => String(call[0]));

    expect(sqlStatements[0]).toContain("BEGIN");
    expect(
      sqlStatements.some((statement) =>
        statement.includes("INSERT INTO match_player"),
      ),
    ).toBe(true);
    expect(
      sqlStatements.some((statement) =>
        statement.includes("UPDATE round_result SET user_id = $2 WHERE user_id = $1"),
      ),
    ).toBe(true);
    expect(sqlStatements[sqlStatements.length - 1]).toContain("COMMIT");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("skips work when both ids are identical", async () => {
    const { migrateAnonymousProfile } = await import("./player-profile");

    await migrateAnonymousProfile("same-user", "same-user");

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.mergeLocalDevPlayerProfiles).not.toHaveBeenCalled();
  });

  it("only includes profiles with at least one played match in the leaderboard query", async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          user_id: "active-user",
          display_name: "Active Nova",
          avatar_seed: "seed",
          mmr: 1213,
          wins: 1,
          matches_played: 3,
          best_finish: 1,
        },
      ],
    });

    const { getLeaderboard } = await import("./player-profile");
    const leaderboard = await getLeaderboard(10);

    expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "WHERE matches_played > 0",
    );
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([10]);
    expect(leaderboard).toEqual([
      {
        userId: "active-user",
        displayName: "Active Nova",
        avatarSeed: "seed",
        mmr: 1213,
        wins: 1,
        matchesPlayed: 3,
        bestFinish: 1,
      },
    ]);
  });
});
