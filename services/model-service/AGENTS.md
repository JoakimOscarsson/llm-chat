# Model Service Agent Guide

## Responsibility

Own available-model discovery.

## Owns

- Fetching model list from the provider adapter
- Caching/refresh policy for model inventory
- Model-list normalization for upstream consumers

## Must Not Own

- Chat generation
- UI concerns
- Provider auth/header handling

## Key Quality Bar

- Return predictable model shapes.
- Be resilient to transient upstream failures.
- Support manual refresh cleanly.
