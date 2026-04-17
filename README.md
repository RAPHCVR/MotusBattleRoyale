# Motus Royale

Motus Royale is a local-first multiplayer word arena built as a monorepo:

- `apps/web`: Next.js 16 App Router frontend, Better Auth, ticket APIs
- `apps/game`: Colyseus authoritative realtime server
- `packages/dictionary`: FR dictionary, normalization, solution / allowed / banned lists
- `packages/protocol`: shared room, board, ticket and auth schemas
- `packages/game-core`: scoring, feedback, rounds, eliminations
- `packages/ui`: shared React UI primitives

## Stack

- Next.js 16
- Colyseus
- Better Auth
- PostgreSQL
- Redis
- Docker Compose
- Caddy
- Cloudflare Tunnel / `cloudflared`
- `pnpm` workspaces + Turborepo

## Quick Start

1. Install workspace dependencies:

```powershell
corepack pnpm install
```

2. Build and test the workspace:

```powershell
corepack pnpm --recursive --if-present test
corepack pnpm --recursive --workspace-concurrency=1 --if-present build
```

3. Start the local Docker stack:

```powershell
docker compose up -d postgres redis game web caddy
```

Published host ports are loopback-only (`127.0.0.1`) so the stack stays reachable from your machine and `cloudflared`, but not from the LAN.

If you change `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GAME_WS_URL`, `PASSKEY_RP_ID`, `PASSKEY_ORIGIN`, or `PASSKEY_ORIGINS`, rebuild the `web` image before restarting it:

```powershell
docker compose build web
docker compose up -d --force-recreate web game
```

4. Open the app:

- Web: [http://localhost:3000](http://localhost:3000)
- Play screen: [http://localhost:3000/play](http://localhost:3000/play)
- Game health: [http://localhost:2567/healthz](http://localhost:2567/healthz)
- Postgres host port: `15432`
- Redis host port: `16379`

Stop everything with:

```powershell
docker compose down
```

## Environment

Copy `.env.example` to `.env` before the first Docker start. `compose.yml` now requires the auth/game/database secrets to be present explicitly instead of silently falling back to dev placeholders.

Important variables:

- `BETTER_AUTH_SECRET`
- `GAME_TOKEN_SECRET`
- `GAME_SERVICE_KEY`
- `BASE_DOMAIN`
- `CLOUDFLARED_TUNNEL_ID`
- `CLOUDFLARED_TUNNEL_NAME`
- `CLOUDFLARED_CREDENTIALS_FILE`
- `PUBLIC_ORIGIN_SERVICE`
- `PUBLIC_HOST_HEADER`
- `PASSKEY_RP_ID`
- `PASSKEY_ORIGIN`
- `PASSKEY_ORIGINS`

## Cloudflared Preview

The repo tracks a template at [infra/cloudflared/config.example.yml](C:/Users/rchauvier/OneDrive%20-%20AUBAY/Documents/MotusBattleRoyal/infra/cloudflared/config.example.yml). `cloudflared` does not expand `${VAR}` placeholders inside that YAML, so render the real config first:

```powershell
$env:BASE_DOMAIN="your-domain.example"
$env:CLOUDFLARED_TUNNEL_ID="your-tunnel-id"
node .\scripts\render-cloudflared-config.mjs
cloudflared --config .\infra\cloudflared\config.yml tunnel ingress validate
```

Then start the preview profile:

```powershell
docker compose --profile preview up -d cloudflared
```

Expected hostname:

- `motus.<your-domain>`

Default rendered services target the Docker-side `caddy` container:

- `PUBLIC_ORIGIN_SERVICE=http://caddy:80`

This single-host setup expects the public hostname to hit a reverse proxy that already routes `/` to `web` and `/realtime` to `game`. In this repo, that reverse proxy is `caddy`.

If your named tunnel already exists and `cloudflared` is authenticated locally, you can create the DNS routes with:

```powershell
$env:BASE_DOMAIN="your-domain.example"
$env:CLOUDFLARED_TUNNEL_ID="your-tunnel-id"
node .\scripts\provision-cloudflared-routes.mjs
```

You can also use `CLOUDFLARED_TUNNEL_NAME` instead of the tunnel ID.

The generated file `infra/cloudflared/config.yml` is intentionally ignored.

## Kubernetes

A production-oriented Kustomize overlay is available under [infra/kubernetes/production](C:/Users/rchauvier/OneDrive%20-%20AUBAY/Documents/MotusBattleRoyal/infra/kubernetes/production/README.md).

It includes:

- `web` and `game` deployments with health probes and rolling updates
- `postgres` and `redis` persistent stateful workloads
- separate ingress objects for the frontend host and the realtime host
- GHCR-ready image names for `web` and `game`
- mutable `latest` tags for prod images, with Keel polling the cluster every minute

Render or validate it locally with:

```powershell
corepack pnpm kube:render
corepack pnpm kube:validate
```

Apply it with:

```powershell
kubectl apply -k infra/kubernetes/production
```

## Useful Commands

```powershell
corepack pnpm --filter @motus/web build
corepack pnpm --filter @motus/game build
docker compose build web game
corepack pnpm kube:render
corepack pnpm kube:validate
docker compose logs -f web
docker compose logs -f game
node .\scripts\render-cloudflared-config.mjs
```

## Notes

- `apps/web` uses a webpack build path intentionally. Turbopack resolved the workspace packages incorrectly in this Windows/OneDrive setup.
- `apps/web/scripts/build.mjs` cleans `.next` before build because repeated Windows builds were hitting reparse-point cleanup errors.
- `apps/game/scripts/build.mjs` cleans `dist` and prebuilds shared packages so Docker and local runtime both resolve the emitted server bundle correctly.
