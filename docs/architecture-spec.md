# Architecture Specification

## Recommended Approach

Build a microservice-first web application with a dedicated browser app, a browser-facing API gateway, and narrowly scoped backend services.

Package the system with Docker and orchestrate locally with Docker Compose.

## Why A Gateway Plus Microservices Is Recommended

- Keeps upstream ID/Secret out of browser code.
- Avoids browser CORS issues against Ollama or Cloudflare Tunnel.
- Preserves a single browser contract while internal services evolve independently.
- Lets model discovery, chat orchestration, session storage, and metrics evolve on separate tracks.
- Makes future repo extraction much easier.
- Enables parallel agent implementation with clearer ownership.

## Proposed Stack

### Frontend

- React + TypeScript + Vite
- State/query layer:
  - lightweight local state for active chat/session options
  - TanStack Query for model list, health checks, and metrics polling
- Styling:
  - Tailwind CSS or CSS Modules
- Transport:
  - `fetch()` with readable streams for chat

### Backend Services

- Node.js + TypeScript
- Fastify
- Native `fetch()` / Undici for service-to-service and upstream HTTP calls
- SSE for streaming endpoints
- Zod for config and request validation

### Deployment

- `docker compose` for local/dev deployment
- Separate Dockerfiles for frontend and backend, or a single multi-stage build if desired

## System Context

### Components

- Browser UI
- API gateway
- Chat service
- Model service
- Session service
- Metrics service
- Ollama adapter
- Ollama API server
- Optional metrics endpoint for GPU VRAM
- Local storage for browser-side persisted sessions/settings

### Data Flow

1. User submits prompt in browser.
2. Frontend sends request to API gateway.
3. API gateway calls chat service.
4. Chat service resolves session context and defaults from session service.
5. Chat service builds Ollama request from:
   - user message
   - selected history slice
   - system prompt
   - model name
   - Ollama options
6. Chat service calls the Ollama adapter.
7. Ollama adapter adds configured auth headers and calls Ollama.
8. Streaming events flow back through chat service and API gateway to the frontend.
9. Frontend updates thinking buffer and final answer buffer independently when the upstream emits both channels.

## Streaming Design

## Recommendation

Use the API gateway as the only browser-facing stream relay. Internally, the chat service and Ollama adapter should also use normalized streaming contracts so provider details stay isolated.

## Browser Contract

- `POST /api/chat/stream`
- Response content type:
  - preferred: `text/event-stream`
  - acceptable: newline-delimited JSON over chunked HTTP

## Event Types

- `meta`: request accepted, timestamps, selected model
- `thinking_delta`: incremental thinking text
- `response_delta`: incremental final answer text
- `stats`: generation metadata if provided
- `done`: clean completion marker
- `error`: upstream or relay failure

## Configuration Model

### Server-Side Environment Variables

- `OLLAMA_BASE_URL`
- `OLLAMA_AUTH_ID`
- `OLLAMA_AUTH_SECRET`
- `METRICS_BASE_URL`
- `METRICS_ENABLED`
- `REQUEST_TIMEOUT_MS`

### Fixed Upstream Auth Headers

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

### Browser-Side Settings

- selected model
- system prompt
- request history count
- response history count
- generation parameters
- theme and local persistence preferences

## Session And History Strategy

## Recommendation

Keep session history browser-side for V1, with optional local persistence.

### Why

- Faster to build.
- Avoids designing a database too early.
- Still supports context-window controls before each request.

### Message Preparation

Before each request, the frontend or backend should derive the outbound message list using a deterministic policy:

- include system prompt if enabled
- include the most recent `N` user turns
- include the most recent `M` assistant turns
- include the current user message

The backend should be the final authority on shaping the upstream payload so validation stays centralized.

### Thinking Persistence

- Keep thinking content as part of the stored session transcript.
- Render stored thinking collapsed by default in the message history.
- Render live thinking in a dedicated streaming panel during generation.

## Metrics Architecture

### Design Goal

GPU metrics must never be on the critical chat path.

### Rules

- Chat endpoints and metrics endpoints are isolated.
- Frontend queries metrics on its own timer.
- Backend metrics adapter uses short timeout and safe fallback.
- Unavailable metrics render as non-blocking UI state.

## Ollama Feature Inclusion Strategy

## Include In V1

- model listing
- chat/generate streaming
- system prompt support
- generation options mapping
- stop generation
- context-size tuning
- keep-alive if supported by the deployed Ollama version

## Delay Until V1.1+

- multimodal/image input
- tool calling and structured tools
- embeddings
- JSON schema / structured outputs as a dedicated UI mode
- model pull/delete management from the UI

## GPU/VRAM Constraint Notes

Assuming an RTX 4080 Super 16 GB:

- Concurrent large generations should be treated carefully.
- Large context windows can significantly increase VRAM pressure.
- Bigger models may run with reduced throughput, quantization tradeoffs, or fallback to CPU spill depending on deployment.
- Features that encourage very large prompts or parallel generations should be conservative by default.

## Specific Recommendations For This GPU Budget

- Default to moderate `num_ctx` values unless the user opts in.
- Defer automatic multi-request fan-out features.
- Avoid making speculative decoding or parallel comparison mode part of V1.
- If structured output mode is added, warn that some models will be slower or less reliable.

## Security Notes

- Do not expose upstream credentials in browser source or local storage.
- Redact secrets in logs.
- Validate upstream URLs if editable from UI to avoid accidental SSRF in broader deployments.
- Prefer server-side config for base URL and auth in production.

## Observability

- Basic backend request logs with request IDs.
- Connection status indicators in UI.
- Optional metrics:
  - time to first token
  - total generation duration
  - model refresh timestamp
