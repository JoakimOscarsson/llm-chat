# Packages Agent Guide

## Scope

Shared packages contain reusable contracts and configuration, not service logic.

## Rules

- Put shared types and schemas in packages, not service-local business logic.
- Prefer `packages/contracts` as the shared source of truth.
- Avoid utility-package sprawl without clear reuse value.
- Add tests before broadening shared contracts.
