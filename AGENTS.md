# Repository Agent Guide

## Purpose

This repository is organized for contract-first microservice development and agentic parallel work.

## Top-Level Rules

- Do not bypass service boundaries.
- Do not import implementation code from one service into another service.
- Shared types and schemas belong in `packages/contracts`.
- Browser code belongs only in `apps/web`.
- Browser-visible APIs belong only in `services/api-gateway`.
- Provider-specific Ollama logic belongs only in `services/ollama-adapter`.

## Delivery Order

1. Update contracts and interface docs.
2. Implement or update shared schemas.
3. Implement service endpoints.
4. Implement frontend consumption.
5. Add contract and integration tests.

## Agent Ownership Guidance

- Frontend agents: `apps/web`
- Gateway agents: `services/api-gateway`
- Chat orchestration agents: `services/chat-service`
- Model listing agents: `services/model-service`
- Session persistence agents: `services/session-service`
- Metrics agents: `services/metrics-service`
- Provider adapter agents: `services/ollama-adapter`
- Contract agents: `packages/contracts`
- Architecture/documentation agents: `docs`

## Before Changing Anything

- Read [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1).
- Read [docs/microservices-architecture.md](/Users/joakim/Documents/codex/llm-chat-app/docs/microservices-architecture.md:1).
- Read the nearest local `AGENTS.md` in the folder you are editing.

## Non-Negotiables

- `CF-Access-Client-Id` and `CF-Access-Client-Secret` stay server-side.
- Thinking traces are persisted but collapsed by default in history.
- Global defaults plus per-session overrides are the required settings model.
- Metrics failures must never break chat flows.

## TDD Rule

Use red-green-refactor by default. Read [docs/tdd-guidelines.md](/Users/joakim/Documents/codex/llm-chat-app/docs/tdd-guidelines.md:1) before implementing new behavior.
