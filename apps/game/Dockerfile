FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

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

RUN pnpm --filter @motus/game build

EXPOSE 2567

CMD ["pnpm", "--filter", "@motus/game", "start"]
