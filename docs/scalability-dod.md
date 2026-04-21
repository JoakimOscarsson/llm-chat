# Scalability Definition Of Done

## System DoD

- Postgres-backed session data survives service restarts.
- Redis-backed queue enforces cluster-wide Ollama concurrency.
- No more than `OLLAMA_MAX_PARALLEL_REQUESTS` requests run against Ollama at once.
- Queued requests receive immediate queue status and delayed prompt events.
- Users can cancel queued or running requests.
- Users can retarget a queued request by changing models before execution starts.
- Warmup never jumps ahead of queued real work.
- Runtime status highlights fast-path models from resident model data.
- Helm deploys the app plus Postgres and Redis in-cluster.
- `docker compose` still runs the full stack locally with the same runtime assumptions.

## Track DoD

### Track 0

- contracts frozen
- new docs added
- agent guidance updated

### Track 1

- session-service runs against Postgres
- repository and service tests prove shared state across instances

### Track 2

- adapter queue, slot limiter, cancel, retarget, and runtime status all work through Redis

### Track 3

- gateway and chat-service preserve queue lifecycle and transcript correctness

### Track 4

- UI shows queue status, prompt, cancel, retarget, and fast-path highlighting

### Track 5

- Helm chart renders and lints with default values
- Postgres and Redis are included as chart dependencies

### Track 6

- compose stack includes Postgres and Redis
- local docs cover queue testing
