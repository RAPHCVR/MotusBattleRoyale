import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(2567),
  DATABASE_URL: z.string().default("postgres://motus:motus@localhost:5432/motusroyale"),
  REDIS_URL: z.string().optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  AUTH_VERIFY_URL: z.string().default("http://localhost:3000/api/auth/one-time-token/verify"),
  GAME_PUBLIC_WS_URL: z.string().default("ws://localhost:2567"),
  GAME_PUBLIC_HTTP_URL: z.string().default("http://localhost:2567"),
  GAME_TOKEN_SECRET: z.string().default("dev-game-token-secret-change-me"),
  GAME_SERVICE_KEY: z.string().default("dev-service-key-change"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info")
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
