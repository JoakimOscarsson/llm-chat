# LLM Chat App

Microservice-first Ollama chat application with real-time streaming, model warmup, session management, and a Docker-first local workflow.

## What It Does

- Streams assistant output in real time from an Ollama backend.
- Shows live thinking separately when the selected model supports it.
- Falls back cleanly for non-thinking models instead of failing the chat.
- Warms a model before chat resumes after model switching.
- Persists chat history, settings, and model-switch markers in the running session service.
- Derives new chat titles from the first prompt immediately.
- Filters the model list to chat-capable models only.
- Exposes a GPU metrics panel that degrades safely when no metrics backend exists yet.

## Current Status

Implemented now:

- End-to-end streaming chat through `api-gateway` -> `chat-service` -> `ollama-adapter` -> Ollama
- Session list, session switching, and clear-history action
- Global defaults and per-session overrides
- Prompt/history shaping and Ollama option forwarding
- Real model discovery from Ollama tags/show metadata
- Model warmup flow before chatting with a newly selected model
- Responsive sidebar UI, markdown rendering, and live thinking panel

Current limitations:

- Session persistence is in-memory only, so chats reset if `session-service` restarts.
- The metrics UI is wired, but there is not yet a real external GPU metrics collector in this repo.
- Workspace-wide `lint` is still a placeholder script.

## Workspace Layout

- `apps/web`: React/Vite frontend
- `services/api-gateway`: browser-facing backend
- `services/chat-service`: chat orchestration and request shaping
- `services/model-service`: model discovery and warmup orchestration
- `services/session-service`: sessions, titles, settings, and in-memory history
- `services/metrics-service`: metrics normalization layer
- `services/ollama-adapter`: direct Ollama communication and Cloudflare header injection
- `packages/contracts`: shared schemas and types
- `packages/config`: shared TypeScript configuration
- `docs`: architecture, interface specs, implementation plan, and agent guidance

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

The app injects these fixed upstream auth headers server-side only:

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

## Validation

These commands are the shared validation path used locally, by the pre-push hook, and in GitHub Actions:

- `npm run ci:docker`
- `npm run ci:docker:validate`
- `npm run ci:docker:static-analysis`

Git hooks:

- `npm run hooks:install`

## Docs

Start with:

- [docs/README.md](/Users/joakim/Documents/codex/llm-chat-app/docs/README.md:1)
- [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1)
- [docs/architecture-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/architecture-spec.md:1)
- [docs/implementation-plan.md](/Users/joakim/Documents/codex/llm-chat-app/docs/implementation-plan.md:1)
- [docs/tdd-guidelines.md](/Users/joakim/Documents/codex/llm-chat-app/docs/tdd-guidelines.md:1)

## Notes

- Browser code never receives the Cloudflare/Ollama credentials.
- Embedding-only models are filtered out before the UI model picker sees them.
- When a model does not support separate thinking, the app continues streaming the answer and shows a notice instead.
