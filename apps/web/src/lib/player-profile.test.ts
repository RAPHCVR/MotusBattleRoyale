import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  release: vi.fn(),
  query: vi.fn(),
  mergeLocalDevPlayerProfiles: vi.fn(),
}));

vi.mock("./db", () => ({
  pgPool: {
    connect: mocks.connect,
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
});
