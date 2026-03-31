import { createAvatarSeed, sanitizeDisplayName } from "@motus/game-core";
import type { RoomKind, RoundModifier } from "@motus/protocol";

import { pool } from "./db.js";

export interface StoredPlayerProfile {
  userId: string;
  displayName: string;
  avatarSeed: string;
  mmr: number;
  wins: number;
  matchesPlayed: number;
}

export interface PersistedRoundRecord {
  roundIndex: number;
  solution: string;
  solved: boolean;
  attemptsUsed: number;
  scoreDelta: number;
  modifier: RoundModifier;
  bountyLetter?: string;
  guesses: string[];
}

export interface PersistedPlayerResult {
  userId: string;
  displayName: string;
  avatarSeed: string;
  placement: number;
  score: number;
  clueUsed: boolean;
  solvedRounds: number;
  mmrBefore: number;
  mmrAfter: number;
  roundRecords: PersistedRoundRecord[];
}

export async function getOrCreatePlayerProfile(userId: string, fallbackName: string): Promise<StoredPlayerProfile> {
  const existing = await pool.query<{
    user_id: string;
    display_name: string;
    avatar_seed: string;
    mmr: number;
    wins: number;
    matches_played: number;
  }>(
    `
      SELECT user_id, display_name, avatar_seed, mmr, wins, matches_played
      FROM player_profile
      WHERE user_id = $1
    `,
    [userId]
  );

  if (existing.rowCount) {
    const row = existing.rows[0];
    return {
      userId: row.user_id,
      displayName: sanitizeDisplayName(row.display_name, fallbackName),
      avatarSeed: row.avatar_seed,
      mmr: row.mmr,
      wins: row.wins,
      matchesPlayed: row.matches_played
    };
  }

  const displayName = sanitizeDisplayName(fallbackName, "Guest Nova");
  const avatarSeed = createAvatarSeed(userId);

  const created = await pool.query<{
    user_id: string;
    display_name: string;
    avatar_seed: string;
    mmr: number;
    wins: number;
    matches_played: number;
  }>(
    `
      INSERT INTO player_profile (user_id, display_name, avatar_seed)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id)
      DO UPDATE SET display_name = EXCLUDED.display_name, avatar_seed = EXCLUDED.avatar_seed, updated_at = NOW()
      RETURNING user_id, display_name, avatar_seed, mmr, wins, matches_played
    `,
    [userId, displayName, avatarSeed]
  );

  const row = created.rows[0];
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    mmr: row.mmr,
    wins: row.wins,
    matchesPlayed: row.matches_played
  };
}

export async function persistMatchResult(input: {
  matchId: string;
  roomKind: RoomKind;
  roomCode?: string;
  seed: string;
  winnerUserId?: string;
  startedAt: number;
  endedAt: number;
  metadata: Record<string, unknown>;
  players: PersistedPlayerResult[];
}): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO "match" (id, room_kind, room_code, seed, started_at, ended_at, winner_user_id, metadata)
        VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), $7, $8::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET
          room_kind = EXCLUDED.room_kind,
          room_code = EXCLUDED.room_code,
          seed = EXCLUDED.seed,
          started_at = EXCLUDED.started_at,
          ended_at = EXCLUDED.ended_at,
          winner_user_id = EXCLUDED.winner_user_id,
          metadata = EXCLUDED.metadata
      `,
      [
        input.matchId,
        input.roomKind,
        input.roomCode ?? null,
        input.seed,
        input.startedAt,
        input.endedAt,
        input.winnerUserId ?? null,
        JSON.stringify(input.metadata)
      ]
    );

    await client.query(`DELETE FROM round_result WHERE match_id = $1`, [input.matchId]);
    await client.query(`DELETE FROM match_player WHERE match_id = $1`, [input.matchId]);

    for (const player of input.players) {
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          input.matchId,
          player.userId,
          player.displayName,
          player.avatarSeed,
          player.placement,
          player.score,
          player.solvedRounds,
          player.clueUsed,
          player.mmrBefore,
          player.mmrAfter
        ]
      );

      for (const record of player.roundRecords) {
        await client.query(
          `
            INSERT INTO round_result (
              match_id,
              user_id,
              round_index,
              solution,
              solved,
              attempts_used,
              score_delta,
              modifier,
              bounty_letter,
              guess_history
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
          `,
          [
            input.matchId,
            player.userId,
            record.roundIndex,
            record.solution,
            record.solved,
            record.attemptsUsed,
            record.scoreDelta,
            record.modifier,
            record.bountyLetter ?? null,
            JSON.stringify(record.guesses)
          ]
        );
      }

      const winIncrement = player.placement === 1 ? 1 : 0;

      await client.query(
        `
          UPDATE player_profile
          SET
            mmr = $2,
            wins = wins + $3,
            matches_played = matches_played + 1,
            best_finish = COALESCE(LEAST(best_finish, $6), best_finish, $6),
            display_name = $4,
            avatar_seed = $5,
            updated_at = NOW()
          WHERE user_id = $1
        `,
        [player.userId, player.mmrAfter, winIncrement, player.displayName, player.avatarSeed, player.placement]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
