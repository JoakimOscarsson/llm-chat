# Web App Agent Guide

## Responsibility

Own the browser chat experience and nothing upstream of the gateway contract.

## Must-Haves

- Multi-line composer.
- Streaming chat rendering.
- Live thinking panel during generation.
- Persisted thinking collapsed by default in transcript history.
- Session list and session overrides UI.
- Model picker with manual refresh.
- Non-blocking metrics widget.

## Boundaries

- Do not embed upstream secrets.
- Do not call Ollama directly.
- Do not assume optional metrics data always exists.
- Treat SSE event ordering and interruption as real-world concerns.

## TDD Focus

- Test stream event handling before UI polish.
- Test collapsed thinking history and live thinking panel behavior explicitly.
- Prefer component and reducer tests over brittle DOM-only coverage.
