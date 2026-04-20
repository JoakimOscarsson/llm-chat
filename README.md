# LLM Chat App

Microservice-first Ollama chat application scaffold.

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

This repository is scaffolded but dependencies are not yet installed in this step.

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

- The current local compose setup uses a stub model list from `ollama-adapter` so you can try the Phase 1 shell without a live Ollama backend.
- Streaming chat is not wired yet, so this is currently a clickable shell for models, sessions, and health status.
