# TDD Guidelines

## Purpose

This repository is built with red-green-refactor by default, including the new scalability and Kubernetes work.

## Core Loop

1. Add or update a failing test for the behavior change.
2. Implement the smallest change that makes it pass.
3. Refactor while keeping the suite green.

## Required Coverage By Track

- Contracts/docs track:
  - schema validation tests
  - example payload conformance checks when practical
- Session/Postgres track:
  - repository tests
  - service integration tests
  - multi-instance consistency tests
- Redis queue/runtime track:
  - queue ordering tests
  - slot limiter tests
  - cancel and retarget tests
  - runtime-status tests
- Chat/gateway track:
  - SSE pass-through tests
  - queued-to-started path tests
  - queued and running cancel tests
- Web track:
  - state and interaction tests
  - delayed prompt behavior
  - fast-path highlight behavior
- Helm track:
  - `helm lint`
  - template render tests
- Compose track:
  - compose config validation
  - smoke startup tests

## Streaming And Queue Rules

- Test SSE chunk boundaries explicitly.
- Test queue events before response streaming begins.
- Test queued cancellation separately from running cancellation.
- Test model retarget while queued.
- Test that no fake assistant result is persisted when a queued request is canceled.

## Microservice Rules

- Mock downstream services at the HTTP boundary, not by importing their code.
- Do not implement a new endpoint before its schema exists.
- Do not change a shared schema from a feature track after the coordinator freeze.
- Test degraded dependency behavior as mandatory coverage.

## CI Expectations

Every completed track should leave the shared validation path green and should add the narrowest tests that prove the new behavior.
