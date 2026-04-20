FROM node:22-alpine AS base

WORKDIR /workspace

ENV CI=true

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile=false

FROM base AS validate

RUN pnpm lint
RUN pnpm typecheck
RUN pnpm test
RUN pnpm build

