# Product Specification

## Purpose

Build a Docker-based web application that provides a polished chat interface for interacting with an LLM hosted behind an Ollama-compatible API.

## Primary Goals

- Let a user chat with an LLM in real time through a browser.
- Stream assistant output so responses appear token-by-token.
- Support selecting among currently available Ollama models.
- Preserve a readable session transcript, including separate rendering for model "thinking" versus final answer text when available.
- Keep backend configuration, authentication headers, and advanced request options under user control.
- Prepare the product for async operational panels such as GPU VRAM usage without making the chat experience fragile when optional backends are unavailable.

## Non-Goals For V1

- Multi-user auth and role management.
- Persistent cloud sync across browsers/devices.
- Complex RAG or document indexing.
- Tool calling beyond pass-through support that already exists in Ollama.
- Fine-grained analytics, billing, or quotas.

## Core User Stories

### Chat

- As a user, I can type a multi-line prompt and send it to the selected model.
- As a user, I can see the model response streaming in real time.
- As a user, I can see model "thinking" in a dedicated panel above the final response history when the backend exposes it.
- As a user, I can stop an in-flight generation.

### Configuration

- As a user, I can configure the upstream API base URL.
- As a user, I can configure an ID and Secret that the app backend includes in headers for upstream requests.
- As a user, I can choose which Ollama model to use for the next request.
- As a user, I can control how much prior context is sent with each request.
- As a user, I can edit the system prompt and generation options.

### Operational Awareness

- As a user, I can see whether the Ollama backend is reachable.
- As a user, I can refresh the available model list.
- As a user, I can later see GPU VRAM utilization in a chart or meter when that backend exists.
- As a user, I am not blocked from chatting if the metrics endpoint is offline or times out.

## Functional Requirements

### Chat Experience

- Multi-line text input with keyboard shortcuts:
  - `Enter` sends.
  - `Shift+Enter` inserts a newline.
- Streaming assistant output over Server-Sent Events (SSE) or a chunked HTTP stream relayed by the app backend.
- Separate rendering regions for:
  - user messages
  - assistant final responses
  - assistant thinking traces when available from the backend/model
- Thinking is always shown live in a dedicated panel during generation.
- Persisted thinking in chat history is collapsed by default and can be expanded per message.
- Request cancellation support.
- Error surface that reports upstream failures without breaking the whole session.

### Model Selection

- Fetch available models from Ollama `GET /api/tags`.
- Default recommendation: fetch on app load and provide a manual refresh button.
- Optional future enhancement: background refresh on a modest interval such as every 60-120 seconds.

### Options Screen

- System prompt editor.
- Request history length control.
- Response history length control.
- Sampling settings that map to Ollama options where supported:
  - temperature
  - top_k
  - top_p
  - repeat_penalty
  - seed
  - num_ctx
  - num_predict
  - stop sequences
- Toggle for whether to include "thinking" content in the UI if emitted.
- Toggle for whether to persist chat sessions locally in browser storage.

### Metrics Panel

- Render a reserved widget for VRAM utilization.
- Fetch metrics asynchronously from a separate endpoint.
- Fail independently from the chat path.
- Start with:
  - loading state
  - unavailable state
  - stale data state
  - healthy state

## UX Recommendations

- Use a three-pane mental model:
  - left: session list or utility nav
  - center: chat transcript + composer
  - right or modal: model/options/settings
- Keep "thinking" visually separated from final text to avoid confusion.
- Use optimistic connection indicators for:
  - Ollama connectivity
  - metrics endpoint connectivity

## Suggested Additional Features To Discuss Before Coding

- Session save/export as Markdown or JSON.
- Preset profiles for prompt/options bundles per model.
- Streaming latency indicators: time-to-first-token and total generation duration.
- Regenerate last reply.
- Copy assistant answer and copy raw thinking separately.
- Health panel showing current backend URL, selected model, and last successful refresh time.
- Attachment support only after chat basics are stable.

## Acceptance Criteria For Planning Phase

- The system architecture is documented.
- Key upstream API contracts are documented.
- Implementation is split into sequenced milestones.
- Open product decisions are isolated so they can be resolved without rewriting the whole plan.
