# Implementation Plan

## Delivery Strategy

Build the thinnest end-to-end slice first, then harden around it.

## Phase 0: Project Bootstrap

Status:
Completed.

### Goals

- [x] Initialize repository structure.
- [x] Stand up frontend and microservice dev shells.
- [x] Add Docker and Docker Compose.
- [x] Add shared linting, formatting, and TypeScript baseline.
- [x] Add shared contracts package.
- [x] Add per-service `AGENTS.md`, `README.md`, Dockerfile, and `.env.example`.

### Exit Criteria

- [x] `docker compose up` starts frontend and all planned service containers.
- [x] Frontend can call gateway health endpoint.
- [x] Each service responds on `/health`.

## Phase 1: Chat Skeleton

Status:
Completed.

### Goals

- [x] Basic chat page layout.
- [x] Multi-line input composer.
- [x] Session-local transcript rendering.
- [x] API gateway to model and session services.

### Tasks

- [x] Create shell UI and chat state.
- [x] Add per-service config loading.
- [x] Implement `GET /api/models` through gateway and model service.
- [x] Implement `GET /api/sessions`.
- [x] Implement `GET /api/health`.

### Exit Criteria

- [x] User can load the app and choose a discovered model.

## Phase 2: Streaming Chat

Status:
Completed.

### Goals

- Real-time response streaming from Ollama through adapter, chat service, and gateway to browser.
- Separate thinking and final answer channels in the UI.
- Error handling and stop generation.

### Tasks

- [x] Implement `POST /api/chat/stream`.
- [x] Parse upstream stream format inside the adapter.
- [x] Relay normalized events through chat service and gateway.
- [x] Add frontend streaming reducer/state machine.
- [x] Add abort/cancel flow.

### Exit Criteria

- [x] User sees streamed output in real time.
- [x] Cancel stops both UI stream and upstream request.

## Phase 3: Advanced Request Options

Status:
Completed.

### Goals

- [x] Add options/settings screen.
- [x] Support history shaping and Ollama generation options.
- [x] Persist user preferences locally.

### Tasks

- [x] Build settings UI.
- [x] Define settings schema.
- [x] Implement outbound message shaping in chat service.
- [x] Validate settings via shared contracts and service schemas.

### Exit Criteria

- [x] User can control prompt context and key generation settings.

## Phase 4: Metrics Integration Shell

### Goals

- Add async GPU VRAM widget with graceful fallback.

### Tasks

- Implement backend metrics adapter endpoint.
- Implement dedicated metrics service endpoint.
- Add timeout and unavailable-state handling.
- Render chart/meter component.

### Exit Criteria

- Missing metrics backend does not affect chat.
- Widget clearly distinguishes unavailable vs stale vs current data.

## Phase 5: Hardening And Polish

### Goals

- Improve reliability, accessibility, and operational clarity.

### Tasks

- Add tests for payload shaping and stream parsing.
- [x] Add loading and error states.
- [x] Improve keyboard submit behavior for the composer.
- [x] Gracefully handle non-thinking models while continuing to stream answers.
- Improve keyboard and screen-reader support.
- Add export/copy/regenerate quality-of-life features if time allows.

### Exit Criteria

- Core flows have automated tests.
- UI handles upstream failures gracefully.

## Testing Plan

### Unit

- settings schema validation
- message/history shaping
- upstream stream parser
- metrics adapter fallback behavior

### Integration

- backend to mocked Ollama stream
- frontend rendering streamed events
- cancel request flow

### Manual

- model refresh
- invalid auth headers
- unreachable Ollama
- unreachable metrics backend
- long multi-line input

## Suggested Initial Backlog

1. [x] Scaffold repo and Docker Compose.
2. [x] Add backend config/env loading.
3. [x] Add models endpoint and UI selector.
4. [x] Implement streamed chat relay.
5. [x] Implement transcript rendering with thinking/final separation.
6. [x] Add settings/options screen.
7. [ ] Add metrics panel placeholder and adapter.
8. [ ] Add tests and UX polish.
