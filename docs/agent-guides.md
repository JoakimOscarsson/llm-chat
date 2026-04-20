# Agent Guides

## Purpose

These guides define how implementation work should be split so coding can proceed cleanly with humans or coding agents.

## Architecture Guardrails

- Keep secrets and upstream auth on the backend only.
- Treat streaming as a first-class feature, not a later enhancement.
- Keep metrics independent from chat.
- Prefer stable backend-normalized contracts over leaking raw Ollama responses into the UI.
- Build for graceful degradation when optional upstream capabilities are missing.

## Agent Roles

### Product/Architecture Agent

Responsibilities:

- maintain docs in `docs/`
- resolve open questions into decisions
- keep scope disciplined for V1

Definition of done:

- docs updated when architecture or product decisions change

### Frontend Agent

Responsibilities:

- chat layout and interaction design
- streaming rendering
- settings UI
- local persistence
- accessibility and keyboard behavior

Key constraints:

- do not embed secrets
- assume streams may arrive out of order or end unexpectedly
- treat thinking and final answer as separate render channels

### Backend Agent

Responsibilities:

- config loading
- auth/header injection
- Ollama proxying
- stream normalization
- metrics adapter and health endpoints

Key constraints:

- never log secrets
- validate all inbound request payloads
- expose frontend-friendly events rather than raw upstream chunks

### QA/Verification Agent

Responsibilities:

- verify chat flow
- verify cancellation
- verify model refresh
- verify metrics failure isolation

Key constraints:

- test degraded-backend states explicitly

## Change Management

- Update shared schemas before frontend/backend contract changes land independently.
- Keep file ownership boundaries clean:
  - frontend in `apps/web`
  - backend in `apps/api`
  - shared contracts in `packages/shared`
- Avoid introducing database persistence in V1 without updating the product and architecture docs first.

## PR Checklist

- Does this keep upstream secrets server-side?
- Does this preserve streaming behavior?
- Does the metrics path fail safely?
- Does the UI remain usable if Ollama is unreachable?
- Are settings validated and bounded?
- Are shared types updated if the API shape changed?
