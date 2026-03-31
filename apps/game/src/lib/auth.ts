import { SignJWT, jwtVerify } from "jose";

import { gameTokenClaimsSchema, type GameTokenClaims, type RoomKind } from "@motus/protocol";

import { env } from "./env.js";

const secret = new TextEncoder().encode(env.GAME_TOKEN_SECRET);

export interface VerifiedSessionData {
  session: {
    id: string;
    userId: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    isAnonymous?: boolean | null;
  };
}

export async function verifyOneTimeToken(token: string): Promise<VerifiedSessionData> {
  const response = await fetch(env.AUTH_VERIFY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ token })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Unable to verify one-time token: ${response.status} ${message}`);
  }

  return (await response.json()) as VerifiedSessionData;
}

export async function issueGameToken(payload: {
  sub: string;
  sessionId: string;
  name: string;
  avatarSeed: string;
  mmr: number;
  isAnonymous: boolean;
  roomKind: RoomKind;
  roomCode?: string;
  ticketId: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresIn = payload.expiresInSeconds ?? 60 * 5;

  return new SignJWT({
    sub: payload.sub,
    sessionId: payload.sessionId,
    name: payload.name,
    avatarSeed: payload.avatarSeed,
    mmr: payload.mmr,
    isAnonymous: payload.isAnonymous,
    roomKind: payload.roomKind,
    roomCode: payload.roomCode,
    ticketId: payload.ticketId
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresIn)
    .sign(secret);
}

export async function verifyGameToken(token: string): Promise<GameTokenClaims> {
  const { payload } = await jwtVerify(token, secret);
  return gameTokenClaimsSchema.parse(payload);
}
