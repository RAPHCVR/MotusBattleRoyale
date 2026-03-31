import { Pool } from "pg";

import { env } from "./env.js";

declare global {
  // eslint-disable-next-line no-var
  var __motusGamePool: Pool | undefined;
}

export const pool =
  globalThis.__motusGamePool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10
  });

if (env.NODE_ENV !== "production") {
  globalThis.__motusGamePool = pool;
}
