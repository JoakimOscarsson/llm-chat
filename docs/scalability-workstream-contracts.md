# Scalability Workstream Contracts

## Frozen Env Vars

- `SESSION_STORE_DRIVER`
- `SESSION_STORE_URL`
- `REDIS_URL`
- `OLLAMA_MAX_PARALLEL_REQUESTS`
- `OLLAMA_QUEUE_PROMPT_AFTER_MS`
- `OLLAMA_RUNTIME_STATUS_TTL_MS`
- `POD_INSTANCE_ID`

## Runtime Status

`GET /api/runtime/ollama`

```json
{
  "busy": true,
  "activeRequests": 1,
  "maxParallelRequests": 1,
  "queueDepth": 2,
  "residentModels": ["gemma4"],
  "fastPathModels": ["gemma4"],
  "fetchedAt": "2026-04-21T12:00:00.000Z"
}
```

## Queue SSE Events

`queued`

```text
event: queued
data: {"requestId":"req_123","position":2,"queueDepth":2,"model":"qwen2.5-coder:7b","promptAfterMs":12000}
```

`queue_update`

```text
event: queue_update
data: {"requestId":"req_123","position":1,"queueDepth":1}
```

`queue_prompt`

```text
event: queue_prompt
data: {"requestId":"req_123","position":1,"waitedMs":12034}
```

`started`

```text
event: started
data: {"requestId":"req_123","model":"qwen2.5-coder:7b","startedAt":"2026-04-21T12:00:15.000Z"}
```

## Warm Result

```json
{
  "status": "skipped_queued",
  "model": "qwen2.5-coder:7b",
  "ready": false
}
```

Possible `status` values:

- `warmed`
- `already_resident`
- `skipped_busy`
- `skipped_queued`

## Queued Request Mutation

`PATCH /api/chat/requests/:requestId`

Request:

```json
{
  "model": "qwen2.5-coder:7b"
}
```

Response:

```json
{
  "request": {
    "requestId": "req_123",
    "state": "queued",
    "model": "qwen2.5-coder:7b",
    "position": 2,
    "queueDepth": 2,
    "queuedAt": "2026-04-21T12:00:03.000Z"
  }
}
```
