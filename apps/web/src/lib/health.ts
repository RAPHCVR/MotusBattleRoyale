import { pgPool } from "./db";

export async function getReadyStatus() {
  try {
    await pgPool.query("SELECT 1");

    return {
      ok: true,
      database: "up" as const
    };
  } catch {
    return {
      ok: false,
      database: "down" as const
    };
  }
}
