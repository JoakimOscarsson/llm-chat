# Repository Agent Guide

## Purpose

This repository is organized for contract-first microservice development and parallel agent execution.

## Top-Level Rules

- Do not bypass service boundaries.
- Do not import implementation code from one service into another service.
- Shared contracts belong only in `packages/contracts`.
- Browser code belongs only in `apps/web`.
- Browser-visible APIs belong only in `services/api-gateway`.
- Provider-specific Ollama logic belongs only in `services/ollama-adapter`.

## Scalability Track Freeze

During the Kubernetes scalability project:

- only the coordinator may edit:
  - `packages/contracts/**`
  - `docs/**`
  - `README.md`
  - this file
- implementation tracks must stay inside their owned paths
- any contract mismatch must be escalated to the coordinator rather than patched locally

## Delivery Order

1. Freeze contracts and interface docs.
2. Implement owned track behavior.
3. Add or update tests before implementation details.
4. Merge in gate order.
5. Run final integrated validation before push.

## Before Changing Anything

- Read [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1).
- Read [docs/microservices-architecture.md](/Users/joakim/Documents/codex/llm-chat-app/docs/microservices-architecture.md:1).
- Read [docs/scalability-workstream-contracts.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-workstream-contracts.md:1) when working on the scalability tracks.
- Read the nearest local `AGENTS.md`.

## Non-Negotiables

- `CF-Access-Client-Id` and `CF-Access-Client-Secret` stay server-side.
- Thinking traces are persisted but collapsed by default in history.
- Global defaults plus per-session overrides are the required settings model.
- Metrics failures must never break chat flows.
- The shared Ollama queue is the single concurrency authority once introduced.

## TDD Rule

Use red-green-refactor by default. Read [docs/tdd-guidelines.md](/Users/joakim/Documents/codex/llm-chat-app/docs/tdd-guidelines.md:1) before implementing new behavior.
