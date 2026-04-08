import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

function findRepoRoot(startDir = process.cwd()) {
  let currentDir = startDir;

  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml")) || existsSync(path.join(currentDir, "compose.yml"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return startDir;
    }

    currentDir = parentDir;
  }
}

const repoRoot = findRepoRoot();
config({ path: path.join(repoRoot, ".env"), quiet: true });

function isLocalAddress(value?: string) {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function getHostname(value?: string) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isContainerRuntime() {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

function isLocalDevEnabled() {
  const value = process.env.MOTUS_LOCAL_DEV?.trim().toLowerCase();

  if (value === "0" || value === "false") {
    return false;
  }

  if (value === "1" || value === "true") {
    return true;
  }

  if ((process.env.NODE_ENV ?? "").toLowerCase() === "development") {
    return true;
  }

  const entrypoint = process.argv[1] ?? "";
  return /(^|[\\/])src[\\/].+\.[cm]?[jt]s$/.test(entrypoint);
}

const localDevEnabled = isLocalDevEnabled();
const containerRuntime = isContainerRuntime();
const databaseHost = getHostname(process.env.DATABASE_URL);
const localStorageFallbackEnabled = localDevEnabled || (!containerRuntime && databaseHost === "postgres");
const localCorsOrigin =
  localDevEnabled && !isLocalAddress(process.env.CORS_ORIGIN) ? "http://localhost:3000" : (process.env.CORS_ORIGIN ?? "http://localhost:3000");
const localAuthVerifyUrl =
  localDevEnabled && !isLocalAddress(process.env.AUTH_VERIFY_URL)
    ? "http://localhost:3000/api/auth/one-time-token/verify"
    : (process.env.AUTH_VERIFY_URL ?? "http://localhost:3000/api/auth/one-time-token/verify");
const rawPublicWsUrl = process.env.GAME_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_GAME_WS_URL;
const rawPublicHttpUrl = process.env.GAME_PUBLIC_HTTP_URL ?? process.env.RT_ORIGIN_SERVICE;
const localGamePublicWsUrl =
  localDevEnabled && !isLocalAddress(rawPublicWsUrl)
    ? "ws://localhost:2567"
    : (rawPublicWsUrl ?? "ws://localhost:2567");
const localGamePublicHttpUrl =
  localDevEnabled && !isLocalAddress(rawPublicHttpUrl)
    ? "http://localhost:2567"
    : (rawPublicHttpUrl ?? "http://localhost:2567");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MOTUS_LOCAL_DEV: z.string().optional(),
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

const parsed = envSchema.parse({
  ...process.env,
  CORS_ORIGIN: localCorsOrigin,
  AUTH_VERIFY_URL: localAuthVerifyUrl,
  GAME_PUBLIC_WS_URL: localGamePublicWsUrl,
  GAME_PUBLIC_HTTP_URL: localGamePublicHttpUrl
});

export const env = {
  ...parsed,
  LOCAL_DEV_ENABLED: localDevEnabled,
  LOCAL_STORAGE_FALLBACK_ENABLED: localStorageFallbackEnabled
};

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
