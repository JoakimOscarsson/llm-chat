# API Gateway

## Purpose

Single browser-facing backend entry point.

## Owns

- public API contract
- request ID propagation
- health aggregation
- browser-friendly error normalization

## Depends On

- `chat-service`
- `model-service`
- `session-service`
- `metrics-service`

## Standalone Development

This service should support mocked downstream URLs so public API work can proceed without the full stack running.
