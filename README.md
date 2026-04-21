# LLM Chat App

Microservice-first Ollama chat application with real-time streaming, a shared Ollama execution model, Docker-first local workflows, and Kubernetes/Helm deployment packaging.

## What It Does

- Streams assistant output in real time from an Ollama backend.
- Shows live thinking separately when the selected model supports it.
- Falls back cleanly for non-thinking models instead of failing the chat.
- Warms a model before chat resumes after model switching.
- Persists chat history, settings, and model-switch markers in Postgres-backed session storage.
- Derives new chat titles from the first prompt immediately.
- Filters the model list to chat-capable models only.
- Exposes a GPU metrics panel that degrades safely when no metrics backend exists yet.
- Includes a standalone host-side GPU metrics collector built around `nvidia-smi`.
- Queues Ollama-bound work through a shared concurrency limiter backed by Redis.
- Exposes runtime status so the UI can highlight fast-path models and queue state.

## Current Status

Implemented now:

- End-to-end streaming chat through `api-gateway` -> `chat-service` -> `ollama-adapter` -> Ollama
- Session list, session switching, and clear-history action
- Global defaults and per-session overrides
- Prompt/history shaping and Ollama option forwarding
- Real model discovery from Ollama tags/show metadata
- Model warmup flow before chatting with a newly selected model
- Responsive sidebar UI, markdown rendering, and live thinking panel
- Postgres-backed session persistence with SQL migrations
- Redis-backed global Ollama queue, queued retargeting, and cross-pod cancellation
- Ollama runtime status and fast-path model highlighting
- Kubernetes Helm packaging with in-cluster Postgres and Redis
- Local compose parity for the same runtime topology
- Dockerized Helm validation in CI and the pre-push path
- `kind`-based Kubernetes install and service-health smoke checks in GitHub Actions
- Manual real-backend Kubernetes E2E workflow using GitHub Environment secrets

Current limitations:

- Workspace-wide `lint` is still a placeholder script.

## Workspace Layout

- `apps/web`: React/Vite frontend
- `services/api-gateway`: browser-facing backend
- `services/chat-service`: chat orchestration and request shaping
- `services/model-service`: model discovery and warmup orchestration
- `services/session-service`: sessions, titles, settings, and Postgres-backed history
- `services/metrics-service`: metrics normalization layer
- `host-metrics-server`: standalone host-side GPU telemetry service for the Ollama machine
- `services/ollama-adapter`: direct Ollama communication, Cloudflare header injection, and Redis-backed queue coordination
- `packages/contracts`: shared schemas and types
- `packages/config`: shared TypeScript configuration
- `docs`: architecture, interface specs, implementation plan, and agent guidance
- `deploy/helm`: Kubernetes/Helm packaging for the app plus in-cluster Postgres and Redis

## Run Locally

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Set at least these values in `.env`:

- `OLLAMA_BASE_URL`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `OLLAMA_USE_STUB=false` for a real backend
- `SESSION_STORE_DRIVER=postgres`
- `OLLAMA_MAX_PARALLEL_REQUESTS=1` or higher if your Ollama host can safely handle it

3. Start the full app:

```bash
docker compose up --build
```

4. Open:

- [http://localhost:3000](http://localhost:3000)

Useful default ports:

- `3000`: web
- `4000`: API gateway
- `4001`: chat service
- `4002`: model service
- `4003`: session service
- `4004`: metrics service
- `4005`: Ollama adapter

If `3000` is busy:

```bash
WEB_PORT=3001 docker compose up --build
```

## Environment

The main runtime variables are:

- `OLLAMA_BASE_URL`: upstream Ollama base URL
- `CF_ACCESS_CLIENT_ID`: Cloudflare Access client ID header value
- `CF_ACCESS_CLIENT_SECRET`: Cloudflare Access client secret header value
- `OLLAMA_TIMEOUT_MS`: upstream request timeout
- `OLLAMA_USE_STUB`: use stubbed Ollama responses instead of a real backend
- `SESSION_STORE_DRIVER`: `postgres` for the scalable runtime path
- `SESSION_STORE_URL`: Postgres connection string
- `REDIS_URL`: Redis connection string for queue/runtime coordination
- `OLLAMA_MAX_PARALLEL_REQUESTS`: cluster-wide Ollama concurrency limit
- `OLLAMA_QUEUE_PROMPT_AFTER_MS`: delay before the UI prompts queued users to keep waiting or cancel
- `OLLAMA_RUNTIME_STATUS_TTL_MS`: cache lifetime for fast-path/runtime status polling
- `METRICS_BASE_URL`: external metrics backend base URL that `services/metrics-service` polls

The app injects these fixed upstream auth headers server-side only:

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

## Validation

These commands are the shared validation path used locally, by the pre-push hook, and in GitHub Actions:

- `npm run ci:docker`
- `npm run ci:helm`
- `npm run ci:compose:smoke`
- `npm run ci:host-metrics:smoke`
- `npm run ci:coverage`
- `npm run ci:workflow:lint`
- `npm run ci:docker:validate`
- `npm run ci:docker:static-analysis`

Git hooks:

- `npm run hooks:install`

## Kubernetes

The scalable deployment path now lives under:

- [deploy/helm/README.md](/Users/joakim/Documents/codex/llm-chat-app/deploy/helm/README.md:1)
- [deploy/helm/llm-chat](/Users/joakim/Documents/codex/llm-chat-app/deploy/helm/llm-chat:1)

The Helm chart includes:

- app Deployments and Services
- in-cluster Postgres and Redis dependencies
- ingress with SSE-safe defaults
- HPAs and PDBs for the scalable services
- an optional Cloudflare Tunnel deployment path

GitHub Actions also includes:

- `.github/workflows/k8s-kind-e2e.yml`
  Runs a self-contained `kind` deployment with stubbed Ollama and Kubernetes health smoke checks on every PR and push to `main`.
- `.github/workflows/k8s-real-backend-e2e.yml`
  Manual real-backend cluster E2E using GitHub Environment secrets.

## GitHub Secrets For Real-Backend E2E

Upload the real-backend test secrets in GitHub here:

1. Open your repository on GitHub.
2. Go to `Settings`.
3. Open `Environments`.
4. Create an environment named `e2e-real`.
5. Under `Environment secrets`, add:
   - `OLLAMA_BASE_URL`
   - `CF_ACCESS_CLIENT_ID`
   - `CF_ACCESS_CLIENT_SECRET`

The manual workflow `.github/workflows/k8s-real-backend-e2e.yml` is already configured to read those environment secrets.

## Host GPU Metrics Server

The repo now includes a deployable host-side collector under:

- [host-metrics-server](/Users/joakim/Documents/codex/llm-chat-app/host-metrics-server:1)

It is designed to run on the same host as Ollama with NVIDIA runtime access and exposes:

- `GET /health`
- `GET /version`
- `GET /gpu`

The app-facing flow remains layered:

- `host-metrics-server` collects raw GPU telemetry from `nvidia-smi`
- `services/metrics-service` normalizes that payload into the UI contract
- `api-gateway` and the browser continue talking only to `metrics-service`

For host deployment notes and required runtime access, see:

- [host-metrics-server/README.md](/Users/joakim/Documents/codex/llm-chat-app/host-metrics-server/README.md:1)

## Docs

Start with:

- [docs/README.md](/Users/joakim/Documents/codex/llm-chat-app/docs/README.md:1)
- [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1)
- [docs/architecture-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/architecture-spec.md:1)
- [docs/implementation-plan.md](/Users/joakim/Documents/codex/llm-chat-app/docs/implementation-plan.md:1)
- [docs/tdd-guidelines.md](/Users/joakim/Documents/codex/llm-chat-app/docs/tdd-guidelines.md:1)
- [docs/scalability-architecture-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-architecture-spec.md:1)
- [docs/scalability-dod.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-dod.md:1)
- [docs/scalability-implementation-plan.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-implementation-plan.md:1)
- [docs/scalability-workstream-contracts.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-workstream-contracts.md:1)

## Notes

- Browser code never receives the Cloudflare/Ollama credentials.
- Embedding-only models are filtered out before the UI model picker sees them.
- When a model does not support separate thinking, the app continues streaming the answer and shows a notice instead.
- Queued requests can be cancelled or retargeted before execution starts.
