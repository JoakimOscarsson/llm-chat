# Chat Service

## Purpose

Own chat orchestration, context assembly, streaming coordination, and assistant result persistence.

## Depends On

- `session-service`
- `ollama-adapter`

## Standalone Development

This service should run with:

- stubbed session context
- mocked Ollama stream fixtures

That allows stream parsing and cancellation work to proceed independently.
