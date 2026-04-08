import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import {
  getLocalDevLeaderboard,
  mergeLocalDevPlayerProfiles,
} from "./local-dev-store";

describe("local dev store", () => {
  let tempDir = "";
  let storePath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "motus-local-dev-store-"));
    storePath = path.join(tempDir, "store.json");
    process.env.MOTUS_LOCAL_DEV_DATA_PATH = storePath;
  });

  afterEach(async () => {
    delete process.env.MOTUS_LOCAL_DEV_DATA_PATH;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("merges anonymous profiles additively", async () => {
    await writeFile(
      storePath,
      JSON.stringify(
        {
          playerProfiles: [
            {
              userId: "guest",
              displayName: "Guest Nova",
              avatarSeed: "guest-seed",
              mmr: 1240,
              wins: 2,
              matchesPlayed: 5,
              bestFinish: 1,
            },
            {
              userId: "user",
              displayName: "RAPHCVR",
              avatarSeed: "user-seed",
              mmr: 1300,
              wins: 3,
              matchesPlayed: 9,
              bestFinish: 2,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await mergeLocalDevPlayerProfiles("guest", "user");

    await expect(getLocalDevLeaderboard(10)).resolves.toEqual([
      {
        userId: "user",
        displayName: "RAPHCVR",
        avatarSeed: "user-seed",
        mmr: 1300,
        wins: 5,
        matchesPlayed: 14,
        bestFinish: 1,
      },
    ]);
  });

  it("recovers from corrupted json without crashing", async () => {
    await writeFile(storePath, "{broken-json", "utf8");

    await expect(getLocalDevLeaderboard(10)).resolves.toEqual([]);
  });
});
