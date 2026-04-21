# Scalability Implementation Plan

## Phase 0: Foundation Freeze

- Freeze contracts, env names, SSE events, and runtime payloads.
- Update architecture, interface, and agent guidance docs.

## Phase 1: Shared State Backends

- Move session-service to Postgres.
- Introduce migrations and bootstrap flow.
- Add Redis-backed queue coordination in ollama-adapter.

## Phase 2: Service Integration

- Integrate queue lifecycle through chat-service and api-gateway.
- Add queued request mutation endpoint.
- Add runtime status endpoint.

## Phase 3: UI And Local Ops

- Add queue and runtime UX in the web app.
- Add compose parity with Postgres and Redis.

## Phase 4: Kubernetes Packaging

- Add Helm chart, dependencies, ingress, scaling resources, and optional Cloudflare Tunnel support.

## Phase 5: Final Validation

- Docker validation
- service integration tests
- queue integration tests
- Helm lint/render
- compose smoke tests
