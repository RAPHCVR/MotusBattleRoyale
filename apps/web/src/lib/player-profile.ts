import { createAvatarSeed, sanitizeDisplayName } from "@motus/game-core";
import type { PoolClient } from "pg";

import { env } from "./env";
import { pgPool } from "./db";
import {
  getLocalDevLeaderboard,
  isLocalDatabaseConnectionError,
  mergeLocalDevPlayerProfiles,
  upsertLocalDevPlayerProfile,
} from "./local-dev-store";

export interface PlayerProfile {
  userId: string;
  displayName: string;
  avatarSeed: string;
  mmr: number;
  wins: number;
  matchesPlayed: number;
  bestFinish: number | null;
}

export async function ensurePlayerProfile(user: {
  id: string;
  name: string;
}): Promise<PlayerProfile> {
  const displayName = sanitizeDisplayName(user.name, "Guest Nova");
  const avatarSeed = createAvatarSeed(user.id);

  try {
    const result = await pgPool.query<{
      user_id: string;
      display_name: string;
      avatar_seed: string;
      mmr: number;
      wins: number;
      matches_played: number;
      best_finish: number | null;
    }>(
      `
        INSERT INTO player_profile (user_id, display_name, avatar_seed)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_seed = EXCLUDED.avatar_seed,
          updated_at = NOW()
        RETURNING user_id, display_name, avatar_seed, mmr, wins, matches_played, best_finish
      `,
      [user.id, displayName, avatarSeed],
    );

    const row = result.rows[0];
    return {
      userId: row.user_id,
      displayName: row.display_name,
      avatarSeed: row.avatar_seed,
      mmr: row.mmr,
      wins: row.wins,
      matchesPlayed: row.matches_played,
      bestFinish: row.best_finish,
    };
  } catch (error) {
    if (
      env.LOCAL_STORAGE_FALLBACK_ENABLED &&
      isLocalDatabaseConnectionError(error)
    ) {
      return upsertLocalDevPlayerProfile({
        userId: user.id,
        displayName,
        avatarSeed,
      });
    }

    throw error;
  }
}

export async function getLeaderboard(limit = 24): Promise<PlayerProfile[]> {
  try {
    const result = await pgPool.query<{
      user_id: string;
      display_name: string;
      avatar_seed: string;
      mmr: number;
      wins: number;
      matches_played: number;
      best_finish: number | null;
    }>(
      `
        SELECT user_id, display_name, avatar_seed, mmr, wins, matches_played, best_finish
        FROM player_profile
        ORDER BY mmr DESC, wins DESC, matches_played DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarSeed: row.avatar_seed,
      mmr: row.mmr,
      wins: row.wins,
      matchesPlayed: row.matches_played,
      bestFinish: row.best_finish,
    }));
  } catch (error) {
    if (
      env.LOCAL_STORAGE_FALLBACK_ENABLED &&
      isLocalDatabaseConnectionError(error)
    ) {
      return getLocalDevLeaderboard(limit);
    }

    throw error;
  }
}

export async function migrateAnonymousProfile(
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  if (fromUserId === toUserId) {
    return;
  }

  try {
    const client: PoolClient = await pgPool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO player_profile (user_id, display_name, avatar_seed, mmr, wins, matches_played, best_finish)
        SELECT $2, display_name, avatar_seed, mmr, wins, matches_played, best_finish
        FROM player_profile
        WHERE user_id = $1
        ON CONFLICT (user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_seed = EXCLUDED.avatar_seed,
          mmr = GREATEST(player_profile.mmr, EXCLUDED.mmr),
          wins = COALESCE(player_profile.wins, 0) + COALESCE(EXCLUDED.wins, 0),
          matches_played = COALESCE(player_profile.matches_played, 0) + COALESCE(EXCLUDED.matches_played, 0),
          best_finish = COALESCE(LEAST(player_profile.best_finish, EXCLUDED.best_finish), player_profile.best_finish, EXCLUDED.best_finish),
          updated_at = NOW()
      `,
        [fromUserId, toUserId],
      );

      await client.query(`DELETE FROM player_profile WHERE user_id = $1`, [
        fromUserId,
      ]);
      await client.query(
        `
        INSERT INTO match_player (
          match_id,
          user_id,
          display_name,
          avatar_seed,
          placement,
          score,
          solved_rounds,
          clue_used,
          mmr_before,
          mmr_after
        )
        SELECT
          match_id,
          $2,
          display_name,
          avatar_seed,
          placement,
          score,
          solved_rounds,
          clue_used,
          mmr_before,
          mmr_after
        FROM match_player
        WHERE user_id = $1
        ON CONFLICT (match_id, user_id)
        DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_seed = EXCLUDED.avatar_seed,
          placement = LEAST(match_player.placement, EXCLUDED.placement),
          score = GREATEST(match_player.score, EXCLUDED.score),
          solved_rounds = GREATEST(match_player.solved_rounds, EXCLUDED.solved_rounds),
          clue_used = match_player.clue_used OR EXCLUDED.clue_used,
          mmr_before = LEAST(match_player.mmr_before, EXCLUDED.mmr_before),
          mmr_after = GREATEST(match_player.mmr_after, EXCLUDED.mmr_after)
      `,
        [fromUserId, toUserId],
      );
      await client.query(`DELETE FROM match_player WHERE user_id = $1`, [
        fromUserId,
      ]);
      await client.query(
        `UPDATE round_result SET user_id = $2 WHERE user_id = $1`,
        [fromUserId, toUserId],
      );
      await client.query(
        `UPDATE "match" SET winner_user_id = $2 WHERE winner_user_id = $1`,
        [fromUserId, toUserId],
      );
      await client.query(
        `UPDATE sanction SET user_id = $2 WHERE user_id = $1`,
        [fromUserId, toUserId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (
      env.LOCAL_STORAGE_FALLBACK_ENABLED &&
      isLocalDatabaseConnectionError(error)
    ) {
      await mergeLocalDevPlayerProfiles(fromUserId, toUserId);
      return;
    }

    throw error;
  }
}
