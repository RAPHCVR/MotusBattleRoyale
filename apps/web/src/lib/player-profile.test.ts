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

  it("only includes qualified profiles in the leaderboard query", async () => {
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
      "WHERE matches_played >= $2",
    );
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([10, 5]);
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

  it("builds separate established and provisional leaderboard buckets", async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: "qualified-user",
            display_name: "Qualified Nova",
            avatar_seed: "qualified-seed",
            mmr: 1234,
            wins: 3,
            matches_played: 7,
            best_finish: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: "provisional-user",
            display_name: "Provisional Nova",
            avatar_seed: "provisional-seed",
            mmr: 1218,
            wins: 1,
            matches_played: 3,
            best_finish: 2,
          },
        ],
      });

    const {
      getLeaderboardSnapshot,
      LEADERBOARD_MIN_MATCHES,
    } = await import("./player-profile");
    const snapshot = await getLeaderboardSnapshot();

    expect(mocks.poolQuery).toHaveBeenCalledTimes(2);
    expect(String(mocks.poolQuery.mock.calls[0]?.[0])).toContain(
      "WHERE matches_played >= $2",
    );
    expect(String(mocks.poolQuery.mock.calls[1]?.[0])).toContain(
      "WHERE matches_played > 0 AND matches_played < $2",
    );
    expect(snapshot).toEqual({
      established: [
        {
          userId: "qualified-user",
          displayName: "Qualified Nova",
          avatarSeed: "qualified-seed",
          mmr: 1234,
          wins: 3,
          matchesPlayed: 7,
          bestFinish: 1,
        },
      ],
      provisional: [
        {
          userId: "provisional-user",
          displayName: "Provisional Nova",
          avatarSeed: "provisional-seed",
          mmr: 1218,
          wins: 1,
          matchesPlayed: 3,
          bestFinish: 2,
        },
      ],
      minimumMatches: LEADERBOARD_MIN_MATCHES,
    });
  });
});
