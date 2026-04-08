FROM node:24-bookworm-slim AS base

ARG SOURCE_REPOSITORY=https://github.com/RAPHCVR/MotusBattleRoyale
ARG BUILD_VERSION=0.1.0
ARG BUILD_REVISION=unknown

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS builder

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_GAME_WS_URL=ws://localhost:2567
ARG PASSKEY_RP_ID=localhost
ARG PASSKEY_ORIGIN=http://localhost:3000

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
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

RUN pnpm install --frozen-lockfile --ignore-scripts --package-import-method=copy

COPY . .
RUN mkdir -p apps/web/public

RUN pnpm --filter @motus/web build

FROM node:24-bookworm-slim AS runner

ARG SOURCE_REPOSITORY=https://github.com/RAPHCVR/MotusBattleRoyale
ARG BUILD_VERSION=0.1.0
ARG BUILD_REVISION=unknown

LABEL org.opencontainers.image.source=$SOURCE_REPOSITORY \
      org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_REVISION

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/french-wordlist@1.0.0/node_modules/french-wordlist ./node_modules/french-wordlist
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/french-badwords-list@1.0.7/node_modules/french-badwords-list ./node_modules/french-badwords-list
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/french-wordlist@1.0.0/node_modules/french-wordlist ./packages/dictionary/node_modules/french-wordlist
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/french-badwords-list@1.0.7/node_modules/french-badwords-list ./packages/dictionary/node_modules/french-badwords-list

EXPOSE 3000

USER node

CMD ["node", "apps/web/server.js"]
