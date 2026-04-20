# Microservices Architecture

## Intent

The project should be structured so that each meaningful capability can be implemented, tested, and eventually extracted as its own repository without rewriting the rest of the platform.

## Design Principles

- API-first before implementation.
- One primary responsibility per service.
- Browser never talks directly to Ollama or auxiliary backends.
- Every service must be runnable, mockable, and testable on its own.
- Shared contracts live in a dedicated package and are versioned deliberately.
- Cross-service dependencies should point inward toward contracts, not sideways toward implementation details.

## Proposed Runtime Topology

### User-Facing App

- `apps/web`
  - The browser UI.
  - Talks only to `services/api-gateway`.

### Core Microservices

- `services/api-gateway`
  - The only browser-facing backend.
  - Aggregates data for the UI.
  - Handles request IDs, auth/session boundaries, and fan-out to internal services.

- `services/chat-service`
  - Owns chat request shaping and streamed response orchestration.
  - Consumes session/context data.
  - Calls the Ollama adapter for streaming completions.

- `services/model-service`
  - Owns model discovery and model list caching.
  - Talks to Ollama tags endpoint through the adapter layer.

- `services/session-service`
  - Owns session persistence contract.
  - Stores chats, thinking traces, session overrides, and local metadata.
  - Can start with file or lightweight DB backing later, but the service boundary exists immediately.

- `services/metrics-service`
  - Owns GPU VRAM polling and normalization from the separate metrics backend.
  - Must fail safely and never block chat.

- `services/ollama-adapter`
  - Owns all direct communication with the upstream Ollama API.
  - Injects `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
  - Normalizes upstream transport concerns away from core services.

## Why Keep Both `chat-service` And `ollama-adapter`

- `chat-service` owns product logic.
- `ollama-adapter` owns provider-specific mechanics.
- If you later replace or supplement Ollama, product behavior does not need to be rewritten inside the chat service.

## Recommended Initial Communication Pattern

- External: HTTP + SSE between browser and `api-gateway`.
- Internal synchronous: HTTP/JSON for standard request/response.
- Internal streaming: SSE between `api-gateway` -> `chat-service` and `chat-service` -> `ollama-adapter`.
- No broker required in V1.

## Service Independence Rules

Every service should have:

- its own `README.md`
- its own `AGENTS.md`
- its own `package.json`
- its own `Dockerfile`
- local `.env.example`
- unit tests
- contract tests against shared schemas

Every service should be able to run:

- with real dependencies
- with stubbed dependencies
- with local mocks

## Service Dependency Graph

```text
apps/web
  -> services/api-gateway

services/api-gateway
  -> services/chat-service
  -> services/model-service
  -> services/session-service
  -> services/metrics-service

services/chat-service
  -> services/session-service
  -> services/ollama-adapter

services/model-service
  -> services/ollama-adapter

services/ollama-adapter
  -> upstream Ollama server

services/metrics-service
  -> external metrics endpoint
```

## Extraction Readiness

To keep later repo-splitting easy:

- do not import service code from another service directly
- communicate only through HTTP/SSE and shared contracts
- do not let one service read another service's database/files directly
- keep environment variables scoped per service
- prefer stable public endpoints even inside the monorepo

## Agentic Workflow Support

This layout is intentionally favorable for parallel coding agents:

- frontend agent can work in `apps/web`
- chat agent can work in `services/chat-service`
- model/adapter agent can work in `services/model-service` and `services/ollama-adapter`
- metrics agent can work in `services/metrics-service`
- session agent can work in `services/session-service`
- contract agent can work in `packages/contracts`

That separation reduces merge conflicts and helps each agent own a bounded surface.
