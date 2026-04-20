# LLM Chat App

Microservice-first Ollama chat application for streaming conversations through an Ollama backend.

## Workspace Layout

- `apps/web`: React frontend
- `services/api-gateway`: browser-facing backend
- `services/chat-service`: chat orchestration
- `services/model-service`: model discovery
- `services/session-service`: session and settings persistence
- `services/metrics-service`: GPU metrics adapter
- `services/ollama-adapter`: upstream Ollama integration
- `packages/contracts`: shared types and schemas
- `packages/config`: shared TypeScript and lint configuration

## Getting Started

Read [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1) before implementing features.

## Local Validation

- `npm run ci:docker`: runs the same Docker-based validation and static-analysis path as `.github/workflows/ci.yml`.
- `npm run ci:docker:validate`: runs the main lint/typecheck/test/build container.
- `npm run ci:docker:static-analysis`: runs the static-analysis container.
- `npm run hooks:install`: installs the repository-managed Git hooks, including `pre-push`.

## Local App Run

Use the current shell locally with:

```bash
docker compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

If one of the default ports is already in use on your machine, override it inline. Example:

```bash
WEB_PORT=3001 docker compose up --build
```

Notes:

- Copy `.env.example` to `.env` and set `OLLAMA_BASE_URL`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET` for your upstream Ollama server.
- Set `OLLAMA_USE_STUB=false` to use a real Ollama backend. Leave it `true` when you want a fixture-driven local shell.
- The metrics widget is implemented from the app side and degrades cleanly when no metrics backend exists yet.
- Streaming chat, model switching, settings shaping, clear history, and session persistence-in-memory are all wired end to end.
