# Contracts Package

## Purpose

Shared schemas and event contracts for browser-facing and internal service APIs.

## Consumers

- `apps/web`
- all services under `services/`

## Standalone Development

This package should publish schemas independently and include contract fixtures so services can test against stable payloads without depending on one another's runtime code.
