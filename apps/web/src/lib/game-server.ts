import { ticketBundleSchema } from "@motus/protocol";

import { env } from "./env";
import { ensurePlayerProfile } from "./player-profile";

function getRequestOrigin(headers: Headers) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto");

  if (!host) {
    return env.NEXT_PUBLIC_APP_URL;
  }

  const protocol = proto ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

function toWebSocketOrigin(origin: string) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed;
}

function resolveTicketWsEndpoint(headers: Headers, fallbackEndpoint: string) {
  const requestOrigin = getRequestOrigin(headers);
  const requestUrl = new URL(requestOrigin);
  const fallbackUrl = new URL(fallbackEndpoint);

  if (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1") {
    const realtimeOrigin = process.env.RT_ORIGIN_SERVICE ?? "http://localhost:2567";
    const realtimeUrl = new URL(realtimeOrigin);
    const localWsUrl = toWebSocketOrigin(requestOrigin);
    localWsUrl.port = realtimeUrl.port || "2567";
    localWsUrl.pathname = realtimeUrl.pathname === "/" ? "" : realtimeUrl.pathname.replace(/\/$/, "");
    localWsUrl.search = "";
    localWsUrl.hash = "";
    return localWsUrl.toString().replace(/\/$/, "");
  }

  const tunnelHost = process.env.RT_HOST_HEADER?.trim();

  if (tunnelHost) {
    const tunnelWsUrl = toWebSocketOrigin(requestOrigin);
    tunnelWsUrl.host = tunnelHost;
    tunnelWsUrl.pathname = fallbackUrl.pathname === "/" ? "" : fallbackUrl.pathname.replace(/\/$/, "");
    tunnelWsUrl.search = "";
    tunnelWsUrl.hash = "";
    return tunnelWsUrl.toString().replace(/\/$/, "");
  }

  return fallbackEndpoint;
}

async function createOneTimeToken(headers: Headers) {
  const cookie = headers.get("cookie") ?? "";

  if (!cookie) {
    throw new Error("Unauthorized.");
  }

  const authOrigin = getRequestOrigin(headers);
  const sessionResponse = await fetch(`${authOrigin}/api/auth/get-session`, {
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
  const response = await fetch(`${authOrigin}/api/auth/one-time-token/generate`, {
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

async function callGameServer(headers: Headers, path: string, body: Record<string, unknown>) {
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

  const ticketBundle = ticketBundleSchema.parse(payload);

  return {
    ...ticketBundle,
    wsEndpoint: resolveTicketWsEndpoint(headers, ticketBundle.wsEndpoint)
  };
}

export async function createPublicTicket(headers: Headers) {
  const oneTimeToken = await createOneTimeToken(headers);
  return callGameServer(headers, "/internal/tickets/public", { oneTimeToken });
}

export async function createPrivateTicket(headers: Headers) {
  const oneTimeToken = await createOneTimeToken(headers);
  return callGameServer(headers, "/internal/tickets/private", { oneTimeToken });
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
  return callGameServer(headers, "/internal/tickets/private/join", { oneTimeToken, roomCode });
}
