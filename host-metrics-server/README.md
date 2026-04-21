# Host Metrics Server

`host-metrics-server` is a small Dockerized service intended to run on the same host as Ollama with access to `nvidia-smi`.

It exposes:

- `GET /health`
- `GET /version`
- `GET /gpu`

`GET /gpu` returns raw normalized GPU telemetry for one configured GPU. It does not apply app-facing `ok` / `stale` / `unavailable` wrapping; that remains the job of `services/metrics-service`.

## Environment

- `PORT`: HTTP listen port. Default `4010`.
- `HOST_METRICS_GPU_INDEX`: GPU index to read. Default `0`.
- `HOST_METRICS_CMD_TIMEOUT_MS`: `nvidia-smi` timeout in milliseconds. Default `2000`.

## Docker deployment notes

- The container should run on the same GPU host as Ollama.
- The host must have an NVIDIA driver installed.
- Docker must expose the NVIDIA runtime/devices to the container.
- `nvidia-smi` must be visible inside the container.

Typical runtime flags depend on your Docker/NVIDIA setup, but the container needs GPU access and visibility into the host NVIDIA stack.

## Cloudflare routing

Use one Cloudflare Tunnel process on the Ollama host with separate routes or hostnames for:

- Ollama
- `host-metrics-server`

Then point the repo-side `METRICS_BASE_URL` at the metrics route.
