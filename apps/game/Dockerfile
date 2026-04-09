FROM node:24-bookworm-slim AS base

ARG SOURCE_REPOSITORY=https://github.com/RAPHCVR/MotusBattleRoyale
ARG BUILD_VERSION=0.1.0
ARG BUILD_REVISION=unknown

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS builder

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

RUN pnpm --filter @motus/game build
RUN pnpm deploy --filter @motus/game --prod --legacy /prod/game

FROM node:24-bookworm-slim AS runner

ARG SOURCE_REPOSITORY=https://github.com/RAPHCVR/MotusBattleRoyale
ARG BUILD_VERSION=0.1.0
ARG BUILD_REVISION=unknown

LABEL org.opencontainers.image.source=$SOURCE_REPOSITORY \
      org.opencontainers.image.version=$BUILD_VERSION \
      org.opencontainers.image.revision=$BUILD_REVISION

ENV NODE_ENV=production
ENV PORT=2567

WORKDIR /app

COPY --from=builder --chown=node:node /prod/game ./

EXPOSE 2567

USER node

CMD ["node", "dist/index.js"]
