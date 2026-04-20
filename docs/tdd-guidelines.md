# TDD Guidelines

## Purpose

This repository should be built with test-driven development by default.

## Core Loop

1. Write or update a failing test for the desired behavior.
2. Implement the smallest change that makes the test pass.
3. Refactor while keeping the test suite green.

## Test Pyramid

### Contracts

- Validate request and response schemas in `packages/contracts`.
- Treat schema tests as the first guardrail for cross-service stability.

### Unit

- Keep domain logic testable without booting full servers.
- Prefer pure functions for shaping requests, reducing transcripts, parsing streams, and classifying metrics state.

### Integration

- Test each service with mocked downstream dependencies.
- Verify HTTP status, JSON shapes, and SSE event sequences.

### End-To-End

- Add focused E2E coverage for the user-critical path:
  - load app
  - select model
  - send prompt
  - receive streamed reply
  - stop generation

## Streaming-Specific TDD Rules

- Test chunk boundaries explicitly.
- Test partial event delivery.
- Test disconnect/cancel behavior.
- Test degraded upstream behavior.
- Test thinking and final response channels independently.

## Microservice TDD Rules

- Do not implement a new endpoint before its contract test exists.
- Do not change a shared schema without updating tests in the affected service and contracts package.
- Mock downstream services at the HTTP boundary, not by importing their code.

## Frontend TDD Rules

- Test state reducers and event handling before styling details.
- Test transcript rendering for:
  - collapsed thinking
  - expanded thinking
  - live thinking panel
  - streaming assistant output

## CI Expectations

- Pull requests should run typecheck, tests, build, and static analysis.
- A service is not considered done if only the happy path is tested.
