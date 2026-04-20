# Apps Agent Guide

## Scope

`apps/` contains user-facing applications only.

## Rules

- Apps consume service contracts; they do not define backend truth.
- Keep app state and presentation logic local to the app.
- If an app needs a new backend field, update `packages/contracts` and the interface spec first.
