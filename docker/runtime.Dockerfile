FROM node:22-alpine

WORKDIR /workspace

ENV CI=true

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile=false

