# Scalability Implementation Plan

## Phase 0: Foundation Freeze

- [x] Freeze contracts, env names, SSE events, and runtime payloads.
- [x] Update architecture, interface, and agent guidance docs.

## Phase 1: Shared State Backends

- [x] Move session-service to Postgres.
- [x] Introduce migrations and bootstrap flow.
- [x] Add Redis-backed queue coordination in ollama-adapter.

## Phase 2: Service Integration

- [x] Integrate queue lifecycle through chat-service and api-gateway.
- [x] Add queued request mutation endpoint.
- [x] Add runtime status endpoint.

## Phase 3: UI And Local Ops

- [x] Add queue and runtime UX in the web app.
- [x] Add compose parity with Postgres and Redis.

## Phase 4: Kubernetes Packaging

- [x] Add Helm chart, dependencies, ingress, scaling resources, and optional Cloudflare Tunnel support.

## Phase 5: Final Validation

- [x] Docker validation
- [x] service integration tests
- [x] queue integration tests
- [x] Helm lint/render
- [x] compose smoke tests
