# Metrics Service

## Purpose

Own GPU VRAM retrieval, normalization, timeout handling, and stale/unavailable classification.

## Depends On

- external metrics backend

## Standalone Development

Should support fixture-based mock responses and timeout simulation so the UI contract can be implemented even before the real backend exists.
