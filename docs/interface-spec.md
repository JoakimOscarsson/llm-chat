# Detailed Interface Specification

## Purpose

This document defines the public and internal service contracts before scaffolding begins. The goal is to keep implementation parallelizable and extraction-friendly.

## Contract Rules

- All JSON payloads must be schema-validated.
- All services expose `/health`.
- All services expose `/version`.
- Every request accepts or generates `x-request-id`.
- Timestamps use ISO-8601 UTC strings.
- Streaming APIs use SSE unless there is a strong reason not to.

## Service List

- `api-gateway`
- `chat-service`
- `model-service`
- `session-service`
- `metrics-service`
- `ollama-adapter`

## Suggested Local Ports

- `apps/web`: `3000`
- `api-gateway`: `4000`
- `chat-service`: `4001`
- `model-service`: `4002`
- `session-service`: `4003`
- `metrics-service`: `4004`
- `ollama-adapter`: `4005`

These are development defaults only. All service URLs should be environment-configurable.

## Standalone Development Requirement

Every service should support:

- real downstream dependencies
- mocked downstream dependencies
- fixture-driven local development

This means each service should expose environment toggles for stub mode instead of requiring the full platform to run.

## Service Environment Contracts

### `api-gateway`

- `PORT`
- `CHAT_SERVICE_URL`
- `MODEL_SERVICE_URL`
- `SESSION_SERVICE_URL`
- `METRICS_SERVICE_URL`

### `chat-service`

- `PORT`
- `SESSION_SERVICE_URL`
- `OLLAMA_ADAPTER_URL`

### `model-service`

- `PORT`
- `OLLAMA_ADAPTER_URL`
- `MODEL_CACHE_TTL_MS`

### `session-service`

- `PORT`
- `SESSION_STORE_DRIVER`
- `SESSION_STORE_URL`

### `metrics-service`

- `PORT`
- `METRICS_BASE_URL`
- `METRICS_TIMEOUT_MS`
- `METRICS_STALE_AFTER_MS`

### `ollama-adapter`

- `PORT`
- `OLLAMA_BASE_URL`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `OLLAMA_TIMEOUT_MS`
- `OLLAMA_USE_STUB`

## Shared Domain Types

### MessageRole

```ts
type MessageRole = "system" | "user" | "assistant";
```

### ChatMessage

```ts
type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};
```

### ThinkingTrace

```ts
type ThinkingTrace = {
  content: string;
  collapsedByDefault: true;
};
```

### SessionOverrides

```ts
type SessionOverrides = {
  systemPrompt?: string;
  requestHistoryCount?: number;
  responseHistoryCount?: number;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  repeat_penalty?: number;
  seed?: number;
  num_ctx?: number;
  num_predict?: number;
  stop?: string[];
  keep_alive?: string | number;
};
```

### AppDefaults

```ts
type AppDefaults = {
  systemPrompt: string;
  requestHistoryCount: number;
  responseHistoryCount: number;
  streamThinking: boolean;
  persistSessions: boolean;
  options: {
    temperature: number;
    top_k: number;
    top_p: number;
    repeat_penalty: number;
    seed?: number;
    num_ctx: number;
    num_predict: number;
    stop: string[];
    keep_alive?: string | number;
  };
};
```

## External Browser Contract

The browser talks only to `api-gateway`.

### `GET /health`

Gateway health plus dependency summary.

Response:

```json
{
  "status": "ok",
  "service": "api-gateway",
  "dependencies": {
    "chatService": "ok",
    "modelService": "ok",
    "sessionService": "ok",
    "metricsService": "degraded"
  }
}
```

### `GET /api/models`

Response:

```json
{
  "models": [
    {
      "name": "llama3.1:8b",
      "size": 4661224676,
      "modifiedAt": "2026-04-20T18:00:00.000Z"
    }
  ],
  "fetchedAt": "2026-04-20T18:00:00.000Z"
}
```

### `GET /api/sessions`

Response:

```json
{
  "sessions": [
    {
      "id": "sess_123",
      "title": "Troubleshooting nginx config",
      "model": "llama3.1:8b",
      "updatedAt": "2026-04-20T18:00:00.000Z"
    }
  ]
}
```

### `POST /api/sessions`

Request:

```json
{
  "title": "New chat",
  "model": "llama3.1:8b"
}
```

Response:

```json
{
  "session": {
    "id": "sess_123",
    "title": "New chat",
    "model": "llama3.1:8b",
    "createdAt": "2026-04-20T18:00:00.000Z",
    "updatedAt": "2026-04-20T18:00:00.000Z"
  }
}
```

### `GET /api/sessions/:sessionId`

Response:

```json
{
  "session": {
    "id": "sess_123",
    "title": "Troubleshooting nginx config",
    "model": "llama3.1:8b",
    "messages": [
      {
        "id": "msg_1",
        "role": "user",
        "content": "Why is my container restarting?",
        "createdAt": "2026-04-20T18:00:00.000Z"
      },
      {
        "id": "msg_2",
        "role": "assistant",
        "content": "A common cause is...",
        "createdAt": "2026-04-20T18:00:05.000Z",
        "thinking": {
          "content": "Need to inspect likely failure classes first...",
          "collapsedByDefault": true
        }
      }
    ],
    "overrides": {
      "num_ctx": 8192
    }
  }
}
```

### `PATCH /api/sessions/:sessionId`

Purpose:
Update session title, model, or per-session overrides.

### `DELETE /api/sessions/:sessionId/history`

Purpose:
Clear the persisted transcript for the active session without deleting the session itself.

### `POST /api/chat/stream`

Request:

```json
{
  "sessionId": "sess_123",
  "model": "llama3.1:8b",
  "message": "Summarize the failure mode.",
  "streamThinking": true
}
```

Response:

- content type: `text/event-stream`

Event sequence:

```text
event: meta
data: {"requestId":"req_123","sessionId":"sess_123","model":"llama3.1:8b"}

event: thinking_delta
data: {"text":"First I should identify the most likely causes..."}

event: response_delta
data: {"text":"The most likely failure mode is..."}

event: usage
data: {"promptTokens":1042,"completionTokens":188}

event: session_message
data: {"assistantMessageId":"msg_2"}

event: done
data: {"finishReason":"stop"}
```

### `POST /api/chat/stop`

Request:

```json
{
  "requestId": "req_123"
}
```

### `GET /api/settings/defaults`

Response:

```json
{
  "defaults": {
    "systemPrompt": "You are a concise assistant.",
    "requestHistoryCount": 8,
    "responseHistoryCount": 8,
    "streamThinking": true,
    "persistSessions": true,
    "options": {
      "temperature": 0.7,
      "top_k": 40,
      "top_p": 0.9,
      "repeat_penalty": 1.05,
      "num_ctx": 8192,
      "num_predict": 512,
      "stop": []
    }
  }
}
```

### `PUT /api/settings/defaults`

Purpose:
Replace global defaults.

### `GET /api/metrics/gpu`

Response:

```json
{
  "status": "ok",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "gpu": {
    "usedMb": 11234,
    "totalMb": 16384,
    "utilizationPct": 68.6
  }
}
```

## Internal Service Contracts

### `api-gateway` -> `model-service`

#### `GET /internal/models`

Response shape is identical to public `/api/models`.

### `api-gateway` -> `session-service`

#### `GET /internal/sessions`

List sessions.

#### `POST /internal/sessions`

Create session.

#### `GET /internal/sessions/:sessionId`

Fetch full session.

#### `PATCH /internal/sessions/:sessionId`

Update metadata and overrides.

#### `DELETE /internal/sessions/:sessionId/history`

Clear persisted user and assistant turns for a session while preserving session metadata and overrides.

#### `POST /internal/sessions/:sessionId/messages`

Persist a message.

Request:

```json
{
  "message": {
    "id": "msg_1",
    "role": "user",
    "content": "Hello",
    "createdAt": "2026-04-20T18:00:00.000Z"
  }
}
```

#### `POST /internal/sessions/:sessionId/assistant-result`

Persist final assistant content and thinking trace after a completed or interrupted stream.

Request:

```json
{
  "message": {
    "id": "msg_2",
    "role": "assistant",
    "content": "Hi there",
    "createdAt": "2026-04-20T18:00:03.000Z"
  },
  "thinking": {
    "content": "Greet briefly.",
    "collapsedByDefault": true
  }
}
```

### `api-gateway` -> `chat-service`

#### `POST /internal/chat/stream`

Request:

```json
{
  "requestId": "req_123",
  "sessionId": "sess_123",
  "message": "Explain this stack trace.",
  "model": "llama3.1:8b",
  "streamThinking": true
}
```

Response:

- SSE with `meta`, `thinking_delta`, `response_delta`, `usage`, `done`, `error`

#### `POST /internal/chat/stop`

Request:

```json
{
  "requestId": "req_123"
}
```

### `chat-service` -> `session-service`

#### `GET /internal/sessions/:sessionId/context`

Purpose:
Return the resolved conversation payload ingredients:

- selected model
- global defaults
- session overrides
- recent user messages
- recent assistant messages

Response:

```json
{
  "sessionId": "sess_123",
  "model": "llama3.1:8b",
  "globalDefaults": {
    "requestHistoryCount": 8,
    "responseHistoryCount": 8
  },
  "overrides": {
    "num_ctx": 8192
  },
  "history": [
    {
      "role": "user",
      "content": "Earlier question"
    },
    {
      "role": "assistant",
      "content": "Earlier answer"
    }
  ]
}
```

### `chat-service` -> `ollama-adapter`

#### `POST /internal/provider/chat/stream`

Request:

```json
{
  "requestId": "req_123",
  "model": "llama3.1:8b",
  "messages": [
    {
      "role": "system",
      "content": "You are a concise assistant."
    },
    {
      "role": "user",
      "content": "Explain this stack trace."
    }
  ],
  "options": {
    "temperature": 0.7,
    "num_ctx": 8192
  },
  "streamThinking": true
}
```

Response:

- SSE with normalized provider events:
  - `meta`
  - `thinking_delta`
  - `response_delta`
  - `usage`
  - `done`
  - `error`

#### `POST /internal/provider/chat/stop`

Cancel a request if the upstream/provider path supports active cancellation beyond connection abort.

### `model-service` -> `ollama-adapter`

#### `GET /internal/provider/models`

Response:

```json
{
  "models": [
    {
      "name": "llama3.1:8b",
      "size": 4661224676,
      "modifiedAt": "2026-04-20T18:00:00.000Z"
    }
  ],
  "fetchedAt": "2026-04-20T18:00:00.000Z"
}
```

### `metrics-service` -> external metrics backend

The external endpoint is not yet fixed, so the service must adapt arbitrary backend payloads into:

```json
{
  "status": "ok",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "gpu": {
    "usedMb": 11234,
    "totalMb": 16384,
    "utilizationPct": 68.6
  }
}
```

It must also degrade to one of these normalized states when a live metrics backend is not yet available:

```json
{
  "status": "stale",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "reason": "stale_sample",
  "gpu": {
    "usedMb": 11234,
    "totalMb": 16384,
    "utilizationPct": 68.6
  }
}
```

```json
{
  "status": "unavailable",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "reason": "not_configured"
}
```

## Error Contract

All non-stream JSON endpoints should return:

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "Metrics backend did not respond in time.",
    "requestId": "req_123"
  }
}
```

Stream endpoints should emit:

```text
event: error
data: {"code":"UPSTREAM_FAILURE","message":"Ollama stream ended unexpectedly.","requestId":"req_123"}
```

## Versioning Rules

- Public and internal contracts start at `v1`.
- Breaking contract changes require:
  - shared schema update
  - changelog entry
  - service compatibility note

## Contract Test Expectations

Each service should test:

- valid request acceptance
- invalid request rejection
- stable response/event shape
- degraded dependency behavior
- idempotent stop/cancel handling where applicable

## Minimum Health Contract

Every service should expose:

### `GET /health`

```json
{
  "status": "ok",
  "service": "chat-service",
  "version": "0.1.0"
}
```

### `GET /version`

```json
{
  "service": "chat-service",
  "version": "0.1.0",
  "contractVersion": "v1"
}
```
