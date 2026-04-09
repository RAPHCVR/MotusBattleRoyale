import { pool } from "./db.js";

export async function getReadyStatus() {
  try {
    await pool.query("SELECT 1");

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
