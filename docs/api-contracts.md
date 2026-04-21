# API Contracts

## Overview

The app backend exposes a stable UI-oriented API and translates requests to Ollama and auxiliary backends.

## Frontend To App Backend

### `GET /api/health`

Purpose:
Returns app/backend status plus last-known upstream reachability.

Example response:

```json
{
  "status": "ok",
  "ollama": {
    "reachable": true,
    "baseUrl": "https://example-ollama.domain.tld",
    "lastCheckedAt": "2026-04-20T18:00:00.000Z"
  },
  "metrics": {
    "enabled": false,
    "reachable": false
  }
}
```

### `GET /api/models`

Purpose:
Returns normalized list of available models from Ollama.

Example response:

```json
{
  "models": [
    {
      "name": "llama3.1:8b",
      "modifiedAt": "2026-04-20T17:55:00.000Z",
      "size": 4661224676
    }
  ],
  "fetchedAt": "2026-04-20T18:00:00.000Z"
}
```

### `POST /api/chat/stream`

Purpose:
Starts a streamed chat completion request.

Example request body:

```json
{
  "model": "llama3.1:8b",
  "systemPrompt": "You are a concise assistant.",
  "messages": [
    {
      "role": "user",
      "content": "Summarize this log output."
    }
  ],
  "options": {
    "temperature": 0.7,
    "top_k": 40,
    "top_p": 0.9,
    "repeat_penalty": 1.05,
    "seed": 42,
    "num_ctx": 8192,
    "num_predict": 5120,
    "stop": [
      "<END>"
    ]
  },
  "streamThinking": true
}
```

Response:

- content type: `text/event-stream`

Example events:

```text
event: meta
data: {"requestId":"req_123","model":"llama3.1:8b"}

event: thinking_delta
data: {"text":"Let me break this down..."}

event: response_delta
data: {"text":"Here is the summary..."}

event: stats
data: {"evalCount":321,"evalDurationMs":8410}

event: done
data: {"finishReason":"stop"}
```

### `POST /api/chat/stop`

Purpose:
Cancels an in-flight stream if the backend implementation needs explicit server-side cancellation coordination.

Note:
This may be unnecessary if HTTP abort propagation is enough.

### `GET /api/metrics/gpu`

Purpose:
Returns VRAM utilization snapshot from a non-Ollama endpoint.

Example response:

```json
{
  "status": "ok",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "gpu": {
    "index": 0,
    "name": "NVIDIA GeForce RTX 4080 SUPER",
    "usedMb": 11234,
    "totalMb": 16384,
    "utilizationPct": 68.6,
    "temperatureC": 61,
    "powerDrawW": 246.5,
    "powerLimitW": 320
  }
}
```

Unavailable response example:

```json
{
  "status": "unavailable",
  "sampledAt": "2026-04-20T18:00:00.000Z",
  "reason": "timeout"
}
```

## App Backend To Ollama

## Metrics Backend Contract

`services/metrics-service` polls an external host-side metrics backend at:

- `GET ${METRICS_BASE_URL}/gpu`

Expected raw response shape:

```json
{
  "sampledAt": "2026-04-21T15:30:00.000Z",
  "gpu": {
    "index": 0,
    "name": "NVIDIA GeForce RTX 4080 SUPER",
    "usedMb": 11234,
    "totalMb": 16384,
    "utilizationPct": 68,
    "temperatureC": 61,
    "powerDrawW": 246.5,
    "powerLimitW": 320
  }
}
```

Notes:

- `temperatureC`, `powerDrawW`, and `powerLimitW` are optional.
- The host backend returns raw normalized telemetry, not the app-facing `ok` / `stale` / `unavailable` envelope.
- `services/metrics-service` is responsible for timeout handling and stale/unavailable classification.

## Relevant Upstream Endpoints

- `GET /api/tags` for model listing
- chat or generate streaming endpoint, depending on the Ollama API shape/version you standardize on
- optional health/version endpoint

## Header Injection

The backend should inject both configured values into upstream requests:

- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

## Stream Parsing Requirements

- tolerate partial chunks
- map upstream thinking content into `thinking_delta` when supported by the selected model/backend behavior
- map assistant output into `response_delta`
- emit a single terminal `done` or `error` event

## Recommended Timeout Strategy

- model list: medium timeout
- chat stream: long timeout with active-stream allowance
- metrics: short timeout

## Polling Recommendation For Model List

Recommendation:

- fetch once on app load
- expose a visible "Refresh models" action
- optionally auto-refresh when opening the model picker or after a failed chat caused by missing model

Why not aggressive polling by default:

- available models usually change infrequently
- polling adds avoidable backend traffic
- manual refresh is easy to understand and debug
