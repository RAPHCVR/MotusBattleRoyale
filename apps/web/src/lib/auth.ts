import { nanoid } from "nanoid";
import { betterAuth } from "better-auth";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { anonymous, captcha, oneTimeToken } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { createGuestName } from "@motus/game-core";

import { db } from "./db";
import { env } from "./env";
import { fileAuthAdapter } from "./file-auth-adapter";
import { migrateAnonymousProfile } from "./player-profile";

const authStorageMode = env.AUTH_STORAGE_MODE ?? (env.LOCAL_STORAGE_FALLBACK_ENABLED ? "memory" : "postgres");
const defaultLocalOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function expandTrustedOrigin(value?: string) {
  if (!value) {
    return [];
  }

  try {
    const parsed = new URL(value);
    const origins = new Set([parsed.origin]);
    const port = parsed.port ? `:${parsed.port}` : "";

    if (parsed.hostname === "localhost") {
      origins.add(`${parsed.protocol}//127.0.0.1${port}`);
    }

    if (parsed.hostname === "127.0.0.1") {
      origins.add(`${parsed.protocol}//localhost${port}`);
    }

    return [...origins];
  } catch {
    return [value];
  }
}

const trustedOrigins = Array.from(
  new Set(
    [
      env.NEXT_PUBLIC_APP_URL,
      ...env.PASSKEY_ORIGINS,
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.PASSKEY_ORIGIN,
      ...defaultLocalOrigins
    ]
      .flatMap((value) => expandTrustedOrigin(value))
      .filter((value): value is string => Boolean(value))
  )
);

const basePlugins = [
  nextCookies(),
  anonymous({
    generateName: async () => createGuestName(nanoid(8)),
    generateRandomEmail: async () => `guest-${nanoid(10)}@guest.motus-royale.local`,
    onLinkAccount: async ({ anonymousUser, newUser }) => {
      await migrateAnonymousProfile(anonymousUser.user.id, newUser.user.id);
    }
  }),
  oneTimeToken({
    expiresIn: 5
  }),
  passkey({
    rpID: env.PASSKEY_RP_ID,
    origin: env.PASSKEY_ORIGINS,
    rpName: "Motus Royale"
  })
];

const plugins = env.TURNSTILE_SECRET_KEY
  ? [
      ...basePlugins,
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-up/email", "/sign-in/email", "/sign-in/anonymous"]
      })
    ]
  : basePlugins;

export const auth = betterAuth({
  database:
    authStorageMode === "memory"
      ? fileAuthAdapter()
      : {
          db,
          type: "postgres"
        },
  baseURL: env.AUTH_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true
  },
  plugins
});

export const authHandlers = toNextJsHandler(auth);
