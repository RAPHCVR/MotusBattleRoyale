import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface LocalDevPlayerProfile {
  userId: string;
  displayName: string;
  avatarSeed: string;
  mmr: number;
  wins: number;
  matchesPlayed: number;
  bestFinish: number | null;
}

interface LocalDevStoreData {
  playerProfiles: LocalDevPlayerProfile[];
}

export interface LocalDevLeaderboardSnapshot {
  established: LocalDevPlayerProfile[];
  provisional: LocalDevPlayerProfile[];
  minimumMatches: number;
}

const DEFAULT_STORE_DATA: LocalDevStoreData = {
  playerProfiles: [],
};
const STORE_LOCK_RETRY_MS = 50;
const STORE_STALE_LOCK_MS = 10_000;
const STORE_LOCK_TIMEOUT_MS = 2_500;

function getStorePath() {
  return (
    process.env.MOTUS_LOCAL_DEV_DATA_PATH ??
    path.join(os.tmpdir(), "motus-royale-local-dev-store.json")
  );
}

async function readStore(): Promise<LocalDevStoreData> {
  try {
    const raw = await readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalDevStoreData>;

    return {
      playerProfiles: Array.isArray(parsed.playerProfiles)
        ? parsed.playerProfiles
        : [],
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;

    if (code === "ENOENT" || error instanceof SyntaxError) {
      return structuredClone(DEFAULT_STORE_DATA);
    }

    throw error;
  }
}

async function writeStore(store: LocalDevStoreData) {
  const storePath = getStorePath();
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tempPath, storePath);
}

function sortProfiles(profiles: LocalDevPlayerProfile[]) {
  return [...profiles].sort((left, right) => {
    if (left.mmr !== right.mmr) {
      return right.mmr - left.mmr;
    }

    if (left.wins !== right.wins) {
      return right.wins - left.wins;
    }

    if (left.matchesPlayed !== right.matchesPlayed) {
      return right.matchesPlayed - left.matchesPlayed;
    }

    if (left.bestFinish == null && right.bestFinish != null) {
      return 1;
    }

    if (left.bestFinish != null && right.bestFinish == null) {
      return -1;
    }

    if (
      left.bestFinish != null &&
      right.bestFinish != null &&
      left.bestFinish !== right.bestFinish
    ) {
      return left.bestFinish - right.bestFinish;
    }

    const displayNameOrder = left.displayName.localeCompare(
      right.displayName,
      "fr",
    );

    if (displayNameOrder !== 0) {
      return displayNameOrder;
    }

    return left.userId.localeCompare(right.userId, "fr");
  });
}

function buildLeaderboardSnapshot(
  profiles: LocalDevPlayerProfile[],
  minimumMatches: number,
  establishedLimit: number,
  provisionalLimit: number,
): LocalDevLeaderboardSnapshot {
  const sortedProfiles = sortProfiles(profiles);

  return {
    established: sortedProfiles
      .filter((profile) => profile.matchesPlayed >= minimumMatches)
      .slice(0, establishedLimit),
    provisional: sortedProfiles
      .filter(
        (profile) =>
          profile.matchesPlayed > 0 && profile.matchesPlayed < minimumMatches,
      )
      .sort((left, right) => {
        if (left.matchesPlayed !== right.matchesPlayed) {
          return right.matchesPlayed - left.matchesPlayed;
        }

        return sortProfiles([left, right])[0] === left ? -1 : 1;
      })
      .slice(0, provisionalLimit),
    minimumMatches,
  };
}

function sleep(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

async function acquireStoreLock(storePath: string) {
  const lockPath = `${storePath}.lock`;
  const deadline = Date.now() + STORE_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const handle = await open(lockPath, "wx");

      return async () => {
        await handle.close();
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : null;

      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const currentLock = await stat(lockPath);

        if (Date.now() - currentLock.mtimeMs > STORE_STALE_LOCK_MS) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        const statCode =
          statError && typeof statError === "object" && "code" in statError
            ? String(statError.code)
            : null;

        if (statCode !== "ENOENT") {
          throw statError;
        }
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out while waiting for local dev store lock at ${lockPath}.`,
        );
      }

      await sleep(STORE_LOCK_RETRY_MS);
    }
  }
}

async function updateStore<T>(
  mutate: (store: LocalDevStoreData) => Promise<T> | T,
) {
  const storePath = getStorePath();
  const release = await acquireStoreLock(storePath);

  try {
    const store = await readStore();
    const result = await mutate(store);
    store.playerProfiles = sortProfiles(store.playerProfiles);
    await writeStore(store);
    return result;
  } finally {
    await release();
  }
}

export function isLocalDatabaseConnectionError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (current instanceof AggregateError) {
      queue.push(...current.errors);
    }

    if (current instanceof Error && current.message.includes("ECONNREFUSED")) {
      return true;
    }

    if (typeof current === "object") {
      if ("code" in current && typeof current.code === "string") {
        if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(current.code)) {
          return true;
        }
      }

      if ("errors" in current && Array.isArray(current.errors)) {
        queue.push(...current.errors);
      }

      if ("cause" in current && current.cause) {
        queue.push(current.cause);
      }
    }
  }

  return false;
}

export async function upsertLocalDevPlayerProfile(input: {
  userId: string;
  displayName: string;
  avatarSeed: string;
}) {
  return updateStore((store) => {
    const existing = store.playerProfiles.find(
      (profile) => profile.userId === input.userId,
    );

    if (existing) {
      existing.displayName = input.displayName;
      existing.avatarSeed = input.avatarSeed;
      return existing;
    }

    const created: LocalDevPlayerProfile = {
      userId: input.userId,
      displayName: input.displayName,
      avatarSeed: input.avatarSeed,
      mmr: 1200,
      wins: 0,
      matchesPlayed: 0,
      bestFinish: null,
    };

    store.playerProfiles.push(created);
    return created;
  });
}

export async function getLocalDevLeaderboard(limit = 24) {
  const store = await readStore();
  return sortProfiles(store.playerProfiles)
    .filter((profile) => profile.matchesPlayed > 0)
    .slice(0, limit);
}

export async function getLocalDevLeaderboardSnapshot(input?: {
  establishedLimit?: number;
  provisionalLimit?: number;
  minimumMatches?: number;
}) {
  const store = await readStore();

  return buildLeaderboardSnapshot(
    store.playerProfiles,
    input?.minimumMatches ?? 5,
    input?.establishedLimit ?? 24,
    input?.provisionalLimit ?? 8,
  );
}

export async function mergeLocalDevPlayerProfiles(
  fromUserId: string,
  toUserId: string,
) {
  if (fromUserId === toUserId) {
    return;
  }

  await updateStore((store) => {
    const fromProfile = store.playerProfiles.find(
      (profile) => profile.userId === fromUserId,
    );

    if (!fromProfile) {
      return;
    }

    const targetIndex = store.playerProfiles.findIndex(
      (profile) => profile.userId === toUserId,
    );

    if (targetIndex === -1) {
      store.playerProfiles = store.playerProfiles.map((profile) =>
        profile.userId === fromUserId
          ? {
              ...profile,
              userId: toUserId,
            }
          : profile,
      );
      return;
    }

    const targetProfile = store.playerProfiles[targetIndex]!;
    targetProfile.displayName =
      targetProfile.displayName || fromProfile.displayName;
    targetProfile.avatarSeed =
      targetProfile.avatarSeed || fromProfile.avatarSeed;
    targetProfile.mmr = Math.max(targetProfile.mmr, fromProfile.mmr);
    targetProfile.wins += fromProfile.wins;
    targetProfile.matchesPlayed += fromProfile.matchesPlayed;
    targetProfile.bestFinish =
      [targetProfile.bestFinish, fromProfile.bestFinish]
        .filter((value): value is number => typeof value === "number")
        .sort((left, right) => left - right)[0] ?? null;

    store.playerProfiles = store.playerProfiles.filter(
      (profile) => profile.userId !== fromUserId,
    );
  });
}
