# Agent Guides

## Purpose

These guides define how parallel agents should work in this repository without breaking service boundaries or each other.

## Core Rules

- Keep secrets and upstream auth on the backend only.
- Treat streaming as a first-class feature, not a later enhancement.
- Keep metrics independent from chat.
- Do not bypass service boundaries.
- Do not import implementation code from one service into another.
- Shared types and wire contracts live only in `packages/contracts`.

## Track Ownership

### Coordinator

Owns only:

- `packages/contracts/**`
- `docs/**`
- `AGENTS.md`
- `README.md`

Responsibilities:

- freeze contracts before implementation tracks begin
- approve or reject any post-freeze interface change
- rebroadcast approved contract changes to affected tracks
- merge tracks in gate order
- perform final system validation

### Track Agents

Track agents must stay within their owned paths:

- session persistence: `services/session-service/**`
- Ollama queue/runtime: `services/ollama-adapter/**`
- chat/gateway integration: `services/chat-service/**`, `services/api-gateway/**`
- web queue UX: `apps/web/**`
- Helm deployment: `deploy/helm/**`
- compose parity: `compose.yaml`, local env examples, local run docs

No track agent may edit `packages/contracts/**` or interface docs after the coordinator freezes them.

## Required Reading Before Coding

- [docs/interface-spec.md](/Users/joakim/Documents/codex/llm-chat-app/docs/interface-spec.md:1)
- [docs/microservices-architecture.md](/Users/joakim/Documents/codex/llm-chat-app/docs/microservices-architecture.md:1)
- [docs/scalability-workstream-contracts.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-workstream-contracts.md:1)
- [docs/scalability-merge-sequence.md](/Users/joakim/Documents/codex/llm-chat-app/docs/scalability-merge-sequence.md:1)
- the nearest local `AGENTS.md`

## Contract Change Control

- After Track 0 lands, only the coordinator may edit:
  - `packages/contracts/**`
  - `docs/interface-spec.md`
  - `docs/scalability-workstream-contracts.md`
- If a track discovers a contract mismatch, it must stop at that boundary and report:
  - requested change
  - why current contract is insufficient
  - impact on dependent tracks

## Delivery Rules

- Use a dedicated branch per track.
- Use TDD.
- Test degraded paths, not only happy paths.
- Include in final handoff:
  - branch name
  - files changed
  - tests added or updated
  - new env vars
  - interfaces touched
  - known limitations

## Parallel Safety Rules

- Do not stage or commit unrelated files.
- Do not “clean up” files owned by another track.
- Do not update shared docs opportunistically from a feature branch.
- Prefer compatibility shims over ad hoc contract drift.

## Final Validation Responsibility

Only the coordinator owns:

- final merge conflict resolution
- final integrated Docker validation
- final integration and system tests
- final push to `main`
