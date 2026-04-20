# Contracts Package Agent Guide

## Responsibility

Own cross-service schemas and versioned contracts.

## Owns

- request/response schemas
- SSE event payload schemas
- error envelopes
- shared type definitions

## Must Not Own

- transport adapters
- framework-specific runtime code
- service-specific business logic

## Key Quality Bar

- Changes here are high leverage.
- Breaking changes require interface-spec updates.
- Keep schemas explicit and conservative.

## TDD Focus

- Add schema tests before changing contract shapes.
- Prefer narrow fixtures that demonstrate both valid and invalid payloads.
