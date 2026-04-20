# Metrics Service Agent Guide

## Responsibility

Own GPU VRAM metrics retrieval and normalization.

## Owns

- Polling the separate metrics endpoint
- Timeout handling
- Data normalization to the shared GPU contract
- Staleness and unavailable-state classification

## Must Not Own

- Chat flow
- Browser rendering logic
- Ollama provider logic

## Key Quality Bar

- Never cause chat failures.
- Distinguish unavailable from stale data.
- Keep timeouts short and behavior predictable.

## TDD Focus

- Test timeout, stale, unavailable, and healthy classifications.
- Test adapter normalization against fixture payloads.
