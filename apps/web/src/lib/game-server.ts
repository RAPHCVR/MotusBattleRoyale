import { ticketBundleSchema } from "@motus/protocol";

import { env } from "./env";
import { ensurePlayerProfile } from "./player-profile";

async function createOneTimeToken(headers: Headers) {
  const cookie = headers.get("cookie") ?? "";

  if (!cookie) {
    throw new Error("Unauthorized.");
  }

  const sessionResponse = await fetch(`${env.AUTH_BASE_URL}/get-session`, {
    method: "GET",
    headers: {
      cookie
    },
    cache: "no-store"
  });

  if (!sessionResponse.ok) {
    throw new Error("Unauthorized.");
  }

  const session = (await sessionResponse.json()) as
    | {
        user: {
          id: string;
          name: string;
        };
      }
    | null;

  if (!session) {
    throw new Error("Unauthorized.");
  }

  await ensurePlayerProfile(session.user);
  const response = await fetch(`${env.AUTH_BASE_URL}/one-time-token/generate`, {
    method: "GET",
    headers: {
      cookie
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Unable to generate one-time token.");
  }

  const payload = (await response.json()) as { token: string };
  return payload.token;
}

async function callGameServer(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${env.GAME_SERVER_INTERNAL_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-key": env.GAME_SERVICE_KEY
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to contact game server.");
  }

  return ticketBundleSchema.parse(payload);
}

export async function createPublicTicket(headers: Headers) {
  const oneTimeToken = await createOneTimeToken(headers);
  return callGameServer("/internal/tickets/public", { oneTimeToken });
}

export async function createPrivateTicket(headers: Headers) {
  const oneTimeToken = await createOneTimeToken(headers);
  return callGameServer("/internal/tickets/private", { oneTimeToken });
}

export async function getGameMetrics() {
  try {
    const response = await fetch(`${env.GAME_SERVER_INTERNAL_URL}/internal/metrics`, {
      method: "GET",
      headers: {
        "x-service-key": env.GAME_SERVICE_KEY
      },
      next: { revalidate: 10 }
    });

    if (!response.ok) {
      return { rooms: 0, players: 0 };
    }

    return (await response.json()) as { rooms: number; players: number };
  } catch {
    return { rooms: 0, players: 0 };
  }
}

export async function joinPrivateTicket(headers: Headers, roomCode: string) {
  const oneTimeToken = await createOneTimeToken(headers);
  return callGameServer("/internal/tickets/private/join", { oneTimeToken, roomCode });
}
