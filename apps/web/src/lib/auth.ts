import { nanoid } from "nanoid";
import { betterAuth } from "better-auth";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { anonymous, captcha, oneTimeToken } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { createGuestName } from "@motus/game-core";

import { db } from "./db";
import { env } from "./env";
import { migrateAnonymousProfile } from "./player-profile";

const plugins: any[] = [
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
    origin: env.PASSKEY_ORIGIN,
    rpName: "Motus Royale"
  })
];

if (env.TURNSTILE_SECRET_KEY) {
  plugins.push(
    captcha({
      provider: "cloudflare-turnstile",
      secretKey: env.TURNSTILE_SECRET_KEY,
      endpoints: ["/sign-up/email", "/sign-in/email", "/sign-in/anonymous"]
    })
  );
}

export const auth = betterAuth({
  database: {
    db,
    type: "postgres"
  },
  baseURL: env.AUTH_BASE_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL, env.PASSKEY_ORIGIN],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true
  },
  plugins
});

export const authHandlers = toNextJsHandler(auth);
