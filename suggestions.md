# Suggestions

## Strong Next Features

- Add copy actions for the assistant answer, raw markdown, and thinking trace separately.
- Add regenerate-last-reply so you can retry a turn without retyping.
- Add export for a session as Markdown and JSON.
- Add per-model presets so switching models can also switch preferred `num_ctx`, `temperature`, and thinking behavior.
- Add request timing metrics such as time-to-first-token, load duration, and total response duration.

## Useful UX Improvements

- Add a compact session search bar when the session list grows.
- Add message anchors so a long conversation can jump back to a specific turn.
- Add a “scroll locked” indicator when the user has intentionally scrolled away from the live tail.
- Add richer Markdown rendering for tables, code highlighting, and copyable code blocks.
- Add optimistic model warmup hints when the first token is delayed because Ollama is loading weights.

## Backend And Persistence

- Replace in-memory session storage with a durable store such as SQLite or Postgres.
- Add a real metrics collector service that normalizes `nvidia-smi` output into the existing `metrics-service` contract.
- Persist model list cache metadata so the UI can show last-refresh time and stale markers.
- Add structured request logging with shared correlation IDs across every service hop.
- Add a compatibility registry for model capabilities such as thinking support, context ceilings, and unsupported options.

## Advanced Ollama Features

- Add optional support for `format` and structured JSON responses.
- Add tool-calling support with a service boundary dedicated to tool execution.
- Add image and multimodal message input once the target models support it reliably.
- Add logprob and top-logprob inspection in an advanced response inspector.
- Add explicit keep-alive controls for warming and unloading models from the UI.

## Quality And Operations

- Replace placeholder lint scripts with a real workspace-wide lint setup.
- Add visual regression coverage for the polished UI states.
- Add contract tests that verify each public gateway endpoint against shared schemas.
- Add smoke tests that run the full Compose stack against a mocked Ollama server.
- Add release workflows for individual services so they can be extracted into separate repos cleanly later.
