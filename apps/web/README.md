# Web App

## Purpose

User-facing browser application for chat, settings, sessions, models, and metrics display.

## Depends On

- `services/api-gateway`

## Standalone Development

The web app should be runnable against:

- the full local stack
- mocked gateway responses
- recorded SSE fixtures for chat-stream development

## Primary Responsibilities

- transcript rendering
- live thinking panel
- collapsed persisted thinking history
- model selection and refresh
- defaults and session override UX
- metrics visualization
