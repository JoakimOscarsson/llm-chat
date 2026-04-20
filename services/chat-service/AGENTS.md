# Chat Service Agent Guide

## Responsibility

Own chat orchestration and message shaping.

## Owns

- Resolving global defaults plus per-session overrides
- Building the outbound conversation payload
- Coordinating streaming with the provider adapter
- Persisting user and assistant messages via `session-service`

## Must Not Own

- Direct browser contracts
- Raw Ollama transport details
- Session storage implementation details

## Key Quality Bar

- Preserve request/response streaming cleanly.
- Persist thinking traces with assistant messages.
- Support cancellation safely.
