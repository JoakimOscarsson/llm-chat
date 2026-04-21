# Local Compose Stack

This repo keeps `docker compose` as the local topology mirror for the Kubernetes deployment shape.

## Startup

1. Copy the local env example:

```bash
cp .env.example .env
```

2. Start the full stack:

```bash
docker compose up --build
```

If you already have Postgres or Redis running locally, override the host ports in `.env` first, for example:

```bash
POSTGRES_PORT=55432
REDIS_PORT=56379
```

3. Open the app:

- `http://localhost:3000`

## Included infrastructure

The compose stack now includes:

- `postgres` for session/default/history persistence
- `redis` for the shared Ollama queue and runtime coordination

That keeps the local runtime topology aligned with the Kubernetes chart:

- browser -> `api-gateway`
- app services in separate containers
- persistent session backend in Postgres
- distributed queue/limiter backend in Redis

## Queue limit configuration

These env vars control the local queue behavior:

- `OLLAMA_MAX_PARALLEL_REQUESTS`
- `OLLAMA_QUEUE_PROMPT_AFTER_MS`
- `REDIS_URL`

Example `.env` snippet:

```bash
OLLAMA_MAX_PARALLEL_REQUESTS=1
OLLAMA_QUEUE_PROMPT_AFTER_MS=15000
REDIS_URL=redis://redis:6379
```

## Parallel request demo

Once the queue-enabled backend tracks are merged, you can demo the limiter locally like this:

1. Set `OLLAMA_MAX_PARALLEL_REQUESTS=1` in `.env`.
2. Start the stack with `docker compose up --build`.
3. Open the app in two browser tabs.
4. Send a long-running prompt in the first tab.
5. Send a prompt in the second tab while the first is still running.

Expected result:

- the first request starts immediately
- the second request shows queued state instead of overloading Ollama
- cancelling the queued request removes it without producing a fake assistant reply

## Helpful local commands

Validate the composed config:

```bash
docker compose config
```

Start only infrastructure for smoke checks:

```bash
docker compose up -d postgres redis
```

Stop the stack:

```bash
docker compose down
```

Remove local data volumes too:

```bash
docker compose down -v
```
