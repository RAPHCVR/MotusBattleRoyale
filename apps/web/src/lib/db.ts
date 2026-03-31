import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __motusWebPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __motusWebDb: Kysely<Record<string, never>> | undefined;
}

export const pgPool =
  globalThis.__motusWebPgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10
  });

export const db =
  globalThis.__motusWebDb ??
  new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({
      pool: pgPool
    })
  });

if (env.NODE_ENV !== "production") {
  globalThis.__motusWebPgPool = pgPool;
  globalThis.__motusWebDb = db;
}
