# Session Service Agent Guide

## Responsibility

Own conversation persistence and settings state.

## Owns

- Session CRUD
- Message persistence
- Thinking trace persistence
- Session override persistence
- Global defaults persistence contract

## Must Not Own

- Streaming provider calls
- Browser-facing aggregation
- Ollama-specific behaviors

## Key Quality Bar

- Preserve transcript integrity.
- Make history retrieval deterministic.
- Keep overrides and defaults clearly separated.
