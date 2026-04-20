# Services Agent Guide

## Scope

`services/` contains independently runnable backend services.

## Service Rules

- One responsibility per service.
- Every service owns its API contract and local tests.
- Every service must expose `/health`.
- Every service must be runnable with mocks.
- Do not reach into another service's files, database, or internal code.

## Implementation Pattern

- `src/routes`: transport layer
- `src/schemas`: request/response validation
- `src/domain`: core business logic
- `src/clients`: downstream service or provider clients
- `src/lib`: local utilities only

## TDD Focus

- Start with route, schema, or domain tests before implementation.
- Mock downstream services at HTTP boundaries.
- Treat degraded dependency behavior as mandatory test coverage.
