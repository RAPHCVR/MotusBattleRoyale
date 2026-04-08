import cors from "cors";
import express from "express";
import {
  type Client,
  LocalDriver,
  LocalPresence,
  RedisDriver,
  RedisPresence,
  Server,
  WebSocketTransport,
  matchMaker
} from "colyseus";
import { customAlphabet, nanoid } from "nanoid";

import { privateRoomJoinRequestSchema, ticketBundleSchema } from "@motus/protocol";

import { issueGameToken, verifyOneTimeToken } from "./lib/auth.js";
import { corsOrigins, env } from "./lib/env.js";
import { getReadyStatus } from "./lib/health.js";
import { getOrCreatePlayerProfile } from "./lib/store.js";
import { PrivateLobbyRoom } from "./rooms/PrivateLobbyRoom.js";
import { PublicQueueRoom } from "./rooms/PublicQueueRoom.js";

const roomCodeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

function createServer() {
  const presence = env.REDIS_URL ? new RedisPresence(env.REDIS_URL) : new LocalPresence();
  const driver = env.REDIS_URL ? new RedisDriver(env.REDIS_URL) : new LocalDriver();

  return new Server({
    transport: new WebSocketTransport(),
    presence,
    driver,
    express: (app) => configureHttp(app)
  });
}

async function createVerifiedTicket(params: {
  oneTimeToken: string;
  roomKind: "public" | "private";
  roomCode?: string;
}) {
  const verified = await verifyOneTimeToken(params.oneTimeToken);
  const profile = await getOrCreatePlayerProfile(verified.user.id, verified.user.name);
  const token = await issueGameToken({
    sub: verified.user.id,
    sessionId: verified.session.id,
    name: profile.displayName,
    avatarSeed: profile.avatarSeed,
    mmr: profile.mmr,
    isAnonymous: Boolean(verified.user.isAnonymous),
    roomKind: params.roomKind,
    roomCode: params.roomCode,
    ticketId: nanoid(12)
  });

  return {
    userId: verified.user.id,
    profile,
    token
  };
}

async function reservePublicSeat(oneTimeToken: string) {
  const ticket = await createVerifiedTicket({
    oneTimeToken,
    roomKind: "public"
  });

  const rooms = await matchMaker.query({
    name: "public-queue",
    private: false,
    locked: false
  });

  const room =
    rooms
      .filter((entry) => String(entry.metadata?.phase ?? "") !== "results")
      .sort((left, right) => {
        const leftAnchor = Number(left.metadata?.anchorMmr ?? ticket.profile.mmr);
        const rightAnchor = Number(right.metadata?.anchorMmr ?? ticket.profile.mmr);
        const leftDistance = Math.abs(leftAnchor - ticket.profile.mmr);
        const rightDistance = Math.abs(rightAnchor - ticket.profile.mmr);

        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        return right.clients - left.clients;
      })[0] ??
    (await matchMaker.createRoom("public-queue", {
      anchorMmr: ticket.profile.mmr,
      seed: nanoid(12)
    }));

  const reservation = await matchMaker.joinById(
    room.roomId,
    {},
    { token: ticket.token, headers: new Headers(), ip: "127.0.0.1" }
  );

  return ticketBundleSchema.parse({
    ticketType: "public",
    token: ticket.token,
    reservation,
    roomId: room.roomId,
    wsEndpoint: env.GAME_PUBLIC_WS_URL
  });
}

async function reservePrivateSeat(oneTimeToken: string) {
  const roomCode = roomCodeAlphabet();
  const ticket = await createVerifiedTicket({
    oneTimeToken,
    roomKind: "private",
    roomCode
  });

  const room = await matchMaker.createRoom("private-lobby", {
    hostUserId: ticket.userId,
    roomCode,
    seed: nanoid(12)
  });

  const reservation = await matchMaker.joinById(
    room.roomId,
    {},
    { token: ticket.token, headers: new Headers(), ip: "127.0.0.1" }
  );

  return ticketBundleSchema.parse({
    ticketType: "private",
    token: ticket.token,
    reservation,
    roomCode,
    roomId: room.roomId,
    wsEndpoint: env.GAME_PUBLIC_WS_URL
  });
}

async function joinPrivateSeat(oneTimeToken: string, requestedCode: string) {
  const roomCode = requestedCode.trim().toUpperCase();
  const ticket = await createVerifiedTicket({
    oneTimeToken,
    roomKind: "private",
    roomCode
  });

  const rooms = await matchMaker.query({
    name: "private-lobby",
    private: true
  });

  const room = rooms.find((entry) => String(entry.metadata?.roomCode ?? "").toUpperCase() === roomCode);

  if (!room) {
    throw new Error("Private room not found.");
  }

  const reservation = await matchMaker.joinById(
    room.roomId,
    {},
    { token: ticket.token, headers: new Headers(), ip: "127.0.0.1" }
  );

  return ticketBundleSchema.parse({
    ticketType: "private",
    token: ticket.token,
    reservation,
    roomCode,
    roomId: room.roomId,
    wsEndpoint: env.GAME_PUBLIC_WS_URL
  });
}

function configureHttp(app: express.Application) {
  app.use(
    cors({
      origin: corsOrigins,
      credentials: false
    })
  );
  app.use(express.json());

  app.get("/healthz", (_request: express.Request, response: express.Response) => {
    response.json({
      ok: true,
      processId: matchMaker.processId,
      time: new Date().toISOString()
    });
  });

  app.get("/readyz", async (_request: express.Request, response: express.Response) => {
    const ready = await getReadyStatus();

    response.status(ready.ok ? 200 : 503).json({
      ...ready,
      processId: matchMaker.processId,
      time: new Date().toISOString()
    });
  });

  app.use("/internal", (request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (request.header("x-service-key") !== env.GAME_SERVICE_KEY) {
      response.status(401).json({ error: "Unauthorized internal call." });
      return;
    }

    next();
  });

  app.post("/internal/tickets/public", async (request: express.Request, response: express.Response) => {
    try {
      response.json(await reservePublicSeat(String(request.body?.oneTimeToken ?? "")));
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create public ticket."
      });
    }
  });

  app.get("/internal/metrics", async (_request: express.Request, response: express.Response) => {
    try {
      const rooms = await matchMaker.query({});
      let players = 0;
      for (const room of rooms) {
        players += room.clients;
      }
      response.json({ rooms: rooms.length, players });
    } catch {
      response.json({ rooms: 0, players: 0 });
    }
  });

  app.post("/internal/tickets/private", async (request: express.Request, response: express.Response) => {
    try {
      response.json(await reservePrivateSeat(String(request.body?.oneTimeToken ?? "")));
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create private ticket."
      });
    }
  });

  app.post("/internal/tickets/private/join", async (request: express.Request, response: express.Response) => {
    try {
      const parsed = privateRoomJoinRequestSchema.parse({
        roomCode: request.body?.roomCode
      });

      response.json(await joinPrivateSeat(String(request.body?.oneTimeToken ?? ""), parsed.roomCode));
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "Failed to join private room."
      });
    }
  });
}

async function main() {
  const gameServer = createServer();

  gameServer.define("public-queue", PublicQueueRoom);
  gameServer.define("private-lobby", PrivateLobbyRoom);

  await gameServer.listen(env.PORT);

  // eslint-disable-next-line no-console
  console.log(`Motus game server listening on ${env.GAME_PUBLIC_HTTP_URL}`);
}

void main();
