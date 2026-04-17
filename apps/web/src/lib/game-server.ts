import { ticketBundleSchema } from "@motus/protocol";

import { auth } from "./auth";
import { env } from "./env";
import { ensurePlayerProfile } from "./player-profile";
import { getSessionFromHeaders } from "./session";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function getForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? null;
}

export function resolveAppOrigin(
  headers: Headers,
  options: {
    appUrl?: string;
    localDevEnabled?: boolean;
  } = {},
) {
  const canonicalOrigin = new URL(options.appUrl ?? env.NEXT_PUBLIC_APP_URL)
    .origin;
  const host = getForwardedValue(
    headers.get("x-forwarded-host") ?? headers.get("host"),
  );
  const proto = getForwardedValue(
    headers.get("x-forwarded-proto"),
  )?.toLowerCase();

  if (!host) {
    return canonicalOrigin;
  }

  const protocol =
    proto === "http" || proto === "https"
      ? proto
      : isLoopbackHost(host.split(":")[0] ?? host)
        ? "http"
        : "https";

  try {
    const candidateOrigin = new URL(`${protocol}://${host}`);

    if (options.localDevEnabled ?? env.LOCAL_DEV_ENABLED) {
      if (isLoopbackHost(candidateOrigin.hostname)) {
        return candidateOrigin.origin;
      }
    }
  } catch {
    // Fall back to the configured origin if forwarded headers are malformed.
  }

  return canonicalOrigin;
}

function toWebSocketOrigin(origin: string) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed;
}

export function resolveTicketWsEndpoint(
  headers: Headers,
  fallbackEndpoint: string,
  options: {
    appUrl?: string;
    localDevEnabled?: boolean;
    tunnelHost?: string;
    realtimeOrigin?: string;
  } = {},
) {
  const requestOrigin = resolveAppOrigin(headers, options);
  const requestUrl = new URL(requestOrigin);
  const fallbackUrl = new URL(fallbackEndpoint);

  if (isLoopbackHost(requestUrl.hostname)) {
    const realtimeOrigin =
      options.realtimeOrigin ??
      process.env.PUBLIC_ORIGIN_SERVICE ??
      "http://localhost:2567";
    const realtimeUrl = new URL(realtimeOrigin);
    const localWsUrl = toWebSocketOrigin(requestOrigin);
    localWsUrl.port = realtimeUrl.port || "2567";
    localWsUrl.pathname =
      realtimeUrl.pathname === "/"
        ? ""
        : realtimeUrl.pathname.replace(/\/$/, "");
    localWsUrl.search = "";
    localWsUrl.hash = "";
    return localWsUrl.toString().replace(/\/$/, "");
  }

  const tunnelHost =
    options.tunnelHost?.trim() ??
    process.env.PUBLIC_HOST_HEADER?.trim();

  if (tunnelHost) {
    const tunnelWsUrl = toWebSocketOrigin(requestOrigin);
    tunnelWsUrl.host = tunnelHost;
    tunnelWsUrl.pathname =
      fallbackUrl.pathname === "/"
        ? ""
        : fallbackUrl.pathname.replace(/\/$/, "");
    tunnelWsUrl.search = "";
    tunnelWsUrl.hash = "";
    return tunnelWsUrl.toString().replace(/\/$/, "");
  }

  return fallbackEndpoint;
}

async function createOneTimeToken(headers: Headers) {
  const session = await getSessionFromHeaders(headers);

  if (!session) {
    throw new Error("Unauthorized.");
  }

  await ensurePlayerProfile(session.user);
  const payload = await auth.api.generateOneTimeToken({ headers });

  if (!payload?.token) {
    throw new Error("Unable to generate one-time token.");
  }

  return payload.token;
}

async function callGameServer(
  headers: Headers,
  path: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${env.GAME_SERVER_INTERNAL_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-key": env.GAME_SERVICE_KEY,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to contact game server.");
  }

  const ticketBundle = ticketBundleSchema.parse(payload);

  return {
    ...ticketBundle,
    wsEndpoint: resolveTicketWsEndpoint(headers, ticketBundle.wsEndpoint),
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
    const response = await fetch(
      `${env.GAME_SERVER_INTERNAL_URL}/internal/metrics`,
      {
        method: "GET",
        headers: {
          "x-service-key": env.GAME_SERVICE_KEY,
        },
        next: { revalidate: 10 },
      },
    );

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
  return callGameServer(headers, "/internal/tickets/private/join", {
    oneTimeToken,
    roomCode,
  });
}
