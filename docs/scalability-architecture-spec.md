# Scalability Architecture Specification

## Goal

Make the app deployable on Kubernetes with horizontally scalable app services, a single logical Ollama backend protected by a global shared concurrency limit, and local parity through `docker compose`.

## Runtime Topology

- `web`
  - built static app container
  - served behind ingress
- `api-gateway`
  - browser-facing backend
  - horizontally scalable
- `chat-service`
  - request shaping and transcript orchestration
  - horizontally scalable once request ownership is externalized
- `session-service`
  - session/defaults/message persistence over Postgres
  - app layer horizontally scalable
- `model-service`
  - low-scale service for model metadata and warmup orchestration
- `metrics-service`
  - low-scale stateless service
- `ollama-adapter`
  - provider boundary
  - owns Redis-backed queue, slot limiter, runtime status, and provider execution

## Shared State

### Postgres

Used for durable application state:

- app defaults
- sessions
- session messages
- session overrides

### Redis

Used for coordination state:

- queue membership
- active slot claims
- request lifecycle state
- request owner pod
- cancel signaling
- runtime snapshot cache

## Scaling Guidance

Good HPA candidates:

- `api-gateway`
- `chat-service`
- `session-service`

Low-scale fixed replicas by default:

- `model-service`
- `metrics-service`
- `ollama-adapter`

## Queue Model

- FIFO queue across all Ollama-bound work.
- Cluster-wide concurrency enforced by `OLLAMA_MAX_PARALLEL_REQUESTS`.
- Queued requests remain mutable until they enter `running`.
- Warmup is idle-only:
  - allowed when queue depth is zero and active count is zero
  - skipped otherwise

## Runtime Status

Runtime status is sourced from Ollama `GET /api/ps` and exposed to the UI so it can highlight fast-path model choices.

Runtime payload fields:

- `busy`
- `activeRequests`
- `maxParallelRequests`
- `queueDepth`
- `residentModels`
- `fastPathModels`
- `fetchedAt`

## Local And Kubernetes Parity

- one process per service container in both environments
- same env var names in compose and Helm where possible
- no sidecar-only logic required for core functionality
