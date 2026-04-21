# Host Metrics Server

- Keep this service standalone and extraction-friendly.
- Prefer changes inside `src/collector` for host command parsing and inside `src/server.ts` for HTTP behavior.
- Do not introduce UI-facing `ok|stale|unavailable` wrapping here; that belongs in `services/metrics-service`.
- Treat `nvidia-smi` output as untrusted input and keep parser changes covered by tests.
