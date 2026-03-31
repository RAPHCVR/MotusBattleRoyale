FROM node:24-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS builder

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG AUTH_BASE_URL=http://localhost:3000/api/auth
ARG NEXT_PUBLIC_GAME_WS_URL=ws://localhost:2567
ARG PASSKEY_RP_ID=localhost
ARG PASSKEY_ORIGIN=http://localhost:3000

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV AUTH_BASE_URL=$AUTH_BASE_URL
ENV NEXT_PUBLIC_GAME_WS_URL=$NEXT_PUBLIC_GAME_WS_URL
ENV PASSKEY_RP_ID=$PASSKEY_RP_ID
ENV PASSKEY_ORIGIN=$PASSKEY_ORIGIN

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/game/package.json apps/game/package.json
COPY packages/dictionary/package.json packages/dictionary/package.json
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @motus/web build

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/node_modules/.pnpm/french-wordlist@1.0.0/node_modules/french-wordlist ./node_modules/french-wordlist
COPY --from=builder /app/node_modules/.pnpm/french-badwords-list@1.0.7/node_modules/french-badwords-list ./node_modules/french-badwords-list
COPY --from=builder /app/node_modules/.pnpm/french-wordlist@1.0.0/node_modules/french-wordlist ./packages/dictionary/node_modules/french-wordlist
COPY --from=builder /app/node_modules/.pnpm/french-badwords-list@1.0.7/node_modules/french-badwords-list ./packages/dictionary/node_modules/french-badwords-list

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
