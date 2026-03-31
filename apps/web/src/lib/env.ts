import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://motus:motus@localhost:5432/motusroyale"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  AUTH_BASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().default("dev-better-auth-secret-please-change"),
  GAME_SERVER_INTERNAL_URL: z.string().default("http://localhost:2567"),
  NEXT_PUBLIC_GAME_WS_URL: z.string().default("ws://localhost:2567"),
  GAME_SERVICE_KEY: z.string().default("dev-service-key-change"),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  PASSKEY_RP_ID: z.string().default("localhost"),
  PASSKEY_ORIGIN: z.string().default("http://localhost:3000")
});

const parsed = envSchema.parse({
  ...process.env,
  AUTH_BASE_URL: process.env.AUTH_BASE_URL ?? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth`
});

export const env = parsed;
