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

## TDD Focus

- Test session CRUD and transcript ordering first.
- Test persistence of collapsed thinking traces.
- Test defaults and overrides merge behavior independently.
