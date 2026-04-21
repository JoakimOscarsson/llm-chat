FROM node:22-alpine

WORKDIR /workspace

ENV CI=true

RUN corepack enable

ARG MOCK_NVIDIA_SMI=0

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/config/typescript/package.json packages/config/typescript/package.json
COPY host-metrics-server/package.json host-metrics-server/package.json

RUN pnpm install --filter @llm-chat-app/host-metrics-server... --frozen-lockfile=false

COPY packages/config/typescript packages/config/typescript
COPY host-metrics-server host-metrics-server

RUN if [ "$MOCK_NVIDIA_SMI" = "1" ]; then \
      cp host-metrics-server/mock-bin/nvidia-smi /usr/local/bin/nvidia-smi && \
      chmod +x /usr/local/bin/nvidia-smi; \
    fi

RUN pnpm --filter @llm-chat-app/host-metrics-server build

WORKDIR /workspace/host-metrics-server

EXPOSE 4010

CMD ["pnpm", "start"]
