# Ollama Adapter Agent Guide

## Responsibility

Own all direct communication with the upstream Ollama server.

## Owns

- `CF-Access-Client-Id` and `CF-Access-Client-Secret` header injection
- calling `GET /api/tags`
- calling chat/generate streaming endpoints
- provider response parsing and normalization

## Must Not Own

- session persistence
- browser-facing API design
- chat policy or context-selection rules

## Key Quality Bar

- Keep provider-specific logic isolated here.
- Normalize upstream stream events for downstream services.
- Never leak secrets in logs or responses.

## TDD Focus

- Test header injection without snapshotting secrets.
- Test model-list normalization.
- Test chunked stream parsing, partial chunks, and upstream failure modes.
