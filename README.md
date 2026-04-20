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

- `npm run ci:docker`: runs the same Docker-based validation path as GitHub Actions.
- `npm run hooks:install`: installs the repository-managed Git hooks, including `pre-push`.
