"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { anonymousClient, oneTimeTokenClient } from "better-auth/client/plugins";

const authBaseURL =
  typeof window === "undefined"
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth`
    : new URL("/api/auth", window.location.origin).toString();

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  plugins: [anonymousClient(), oneTimeTokenClient(), passkeyClient()]
});
