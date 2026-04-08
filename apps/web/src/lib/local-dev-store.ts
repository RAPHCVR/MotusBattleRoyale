import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const DEFAULT_STORE_DATA: LocalDevStoreData = {
  playerProfiles: []
};

function getStorePath() {
  return process.env.MOTUS_LOCAL_DEV_DATA_PATH ?? path.join(os.tmpdir(), "motus-royale-local-dev-store.json");
}

async function readStore(): Promise<LocalDevStoreData> {
  try {
    const raw = await readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalDevStoreData>;

    return {
      playerProfiles: Array.isArray(parsed.playerProfiles) ? parsed.playerProfiles : []
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;

    if (code === "ENOENT") {
      return structuredClone(DEFAULT_STORE_DATA);
    }

    throw error;
  }
}

async function writeStore(store: LocalDevStoreData) {
  const storePath = getStorePath();
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function sortProfiles(profiles: LocalDevPlayerProfile[]) {
  return [...profiles].sort((left, right) => {
    if (left.mmr !== right.mmr) {
      return right.mmr - left.mmr;
    }

    if (left.wins !== right.wins) {
      return right.wins - left.wins;
    }

    return right.matchesPlayed - left.matchesPlayed;
  });
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
  const store = await readStore();
  const existing = store.playerProfiles.find((profile) => profile.userId === input.userId);

  if (existing) {
    existing.displayName = input.displayName;
    existing.avatarSeed = input.avatarSeed;
    await writeStore(store);
    return existing;
  }

  const created: LocalDevPlayerProfile = {
    userId: input.userId,
    displayName: input.displayName,
    avatarSeed: input.avatarSeed,
    mmr: 1200,
    wins: 0,
    matchesPlayed: 0,
    bestFinish: null
  };

  store.playerProfiles.push(created);
  await writeStore(store);
  return created;
}

export async function getLocalDevLeaderboard(limit = 24) {
  const store = await readStore();
  return sortProfiles(store.playerProfiles).slice(0, limit);
}

export async function mergeLocalDevPlayerProfiles(fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) {
    return;
  }

  const store = await readStore();
  const fromProfile = store.playerProfiles.find((profile) => profile.userId === fromUserId);

  if (!fromProfile) {
    return;
  }

  const targetIndex = store.playerProfiles.findIndex((profile) => profile.userId === toUserId);

  if (targetIndex === -1) {
    store.playerProfiles = store.playerProfiles.map((profile) =>
      profile.userId === fromUserId
        ? {
            ...profile,
            userId: toUserId
          }
        : profile
    );
    await writeStore(store);
    return;
  }

  const targetProfile = store.playerProfiles[targetIndex]!;
  targetProfile.displayName = targetProfile.displayName || fromProfile.displayName;
  targetProfile.avatarSeed = targetProfile.avatarSeed || fromProfile.avatarSeed;
  targetProfile.mmr = Math.max(targetProfile.mmr, fromProfile.mmr);
  targetProfile.wins = Math.max(targetProfile.wins, fromProfile.wins);
  targetProfile.matchesPlayed = Math.max(targetProfile.matchesPlayed, fromProfile.matchesPlayed);
  targetProfile.bestFinish = [targetProfile.bestFinish, fromProfile.bestFinish]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right)[0] ?? null;

  store.playerProfiles = store.playerProfiles.filter((profile) => profile.userId !== fromUserId);
  await writeStore(store);
}
