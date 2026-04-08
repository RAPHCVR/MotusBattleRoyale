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

function isLocalHost(value?: string) {
  return value === "localhost" || value === "127.0.0.1";
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

  return (process.env.NODE_ENV ?? "development") === "development";
}

const localDevEnabled = isLocalDevEnabled();
const containerRuntime = isContainerRuntime();
const databaseHost = getHostname(process.env.DATABASE_URL);
const gameServerInternalHost = getHostname(process.env.GAME_SERVER_INTERNAL_URL);
const localStorageFallbackEnabled = localDevEnabled || (!containerRuntime && databaseHost === "postgres");
const localAppUrl = localDevEnabled && !isLocalAddress(process.env.NEXT_PUBLIC_APP_URL) ? "http://localhost:3000" : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
const localAuthBaseUrl =
  localDevEnabled && !isLocalAddress(process.env.AUTH_BASE_URL)
    ? `${localAppUrl}/api/auth`
    : (process.env.AUTH_BASE_URL ?? `${localAppUrl}/api/auth`);
const localGameServerInternalUrl =
  (localDevEnabled && !isLocalAddress(process.env.GAME_SERVER_INTERNAL_URL)) || (!containerRuntime && gameServerInternalHost === "game")
    ? "http://localhost:2567"
    : (process.env.GAME_SERVER_INTERNAL_URL ?? "http://localhost:2567");
const localGameWsUrl =
  localDevEnabled && !isLocalAddress(process.env.NEXT_PUBLIC_GAME_WS_URL)
    ? "ws://localhost:2567"
    : (process.env.NEXT_PUBLIC_GAME_WS_URL ?? "ws://localhost:2567");
const localPasskeyOrigin =
  localDevEnabled && !isLocalAddress(process.env.PASSKEY_ORIGIN)
    ? localAppUrl
    : (process.env.PASSKEY_ORIGIN ?? localAppUrl);
const localPasskeyRpId =
  localDevEnabled && !isLocalHost(process.env.PASSKEY_RP_ID) ? "localhost" : (process.env.PASSKEY_RP_ID ?? "localhost");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://motus:motus@localhost:5432/motusroyale"),
  MOTUS_LOCAL_DEV: z.string().optional(),
  AUTH_STORAGE_MODE: z.enum(["memory", "postgres"]).optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  AUTH_BASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().default("dev-better-auth-secret-please-change"),
  GAME_SERVER_INTERNAL_URL: z.string().default("http://localhost:2567"),
  NEXT_PUBLIC_GAME_WS_URL: z.string().default("ws://localhost:2567"),
  GAME_SERVICE_KEY: z.string().default("dev-service-key-change"),
  MOTUS_LOCAL_DEV_DATA_PATH: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  PASSKEY_RP_ID: z.string().default("localhost"),
  PASSKEY_ORIGIN: z.string().default("http://localhost:3000")
});

const parsed = envSchema.parse({
  ...process.env,
  NEXT_PUBLIC_APP_URL: localAppUrl,
  AUTH_BASE_URL: localAuthBaseUrl,
  GAME_SERVER_INTERNAL_URL: localGameServerInternalUrl,
  NEXT_PUBLIC_GAME_WS_URL: localGameWsUrl,
  PASSKEY_RP_ID: localPasskeyRpId,
  PASSKEY_ORIGIN: localPasskeyOrigin
});

export const env = {
  ...parsed,
  LOCAL_DEV_ENABLED: localDevEnabled,
  LOCAL_STORAGE_FALLBACK_ENABLED: localStorageFallbackEnabled
};
