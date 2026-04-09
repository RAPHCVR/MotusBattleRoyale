import { Redis } from "ioredis";

import { pool } from "./db.js";
import { env } from "./env.js";

type ServiceStatus = "up" | "down" | "skipped";

const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    })
  : null;

async function checkDatabase(): Promise<Exclude<ServiceStatus, "skipped">> {
  try {
    await pool.query("SELECT 1");
    return "up";
  } catch {
    return "down";
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  if (!redis) {
    return "skipped";
  }

  try {
    await redis.ping();
    return "up";
  } catch {
    return "down";
  }
}

export async function getReadyStatus() {
  const [database, redisStatus] = await Promise.all([checkDatabase(), checkRedis()]);

  return {
    ok: database === "up" && redisStatus !== "down",
    database,
    redis: redisStatus
  };
}
