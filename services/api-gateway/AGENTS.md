# API Gateway Agent Guide

## Responsibility

This service is the only browser-facing backend entry point.

## Owns

- Public HTTP API consumed by `apps/web`
- Request IDs and top-level error envelopes
- Fan-out to internal services
- Health aggregation

## Must Not Own

- Ollama-specific business logic
- Session persistence internals
- GPU metric collection internals

## Key Quality Bar

- Keep public contracts stable.
- Normalize internal failures into browser-friendly responses.
- Preserve streaming behavior end-to-end.
