# Helm Deployment

This directory contains the Kubernetes Helm packaging for the LLM chat app.

## Validate

Use the bundled validator:

```bash
./deploy/helm/validate.sh
```

It runs `helm dependency build`, `helm lint`, and the required template renders through a Dockerized Helm CLI so a local Helm installation is not required.

## Cluster E2E

The repo now includes two Kubernetes E2E workflows:

- `.github/workflows/k8s-kind-e2e.yml`
  - always-safe `kind` install test
  - uses stubbed Ollama
  - runs smoke checks against the deployed cluster
- `.github/workflows/k8s-real-backend-e2e.yml`
  - manual workflow for a real Ollama backend
  - reads GitHub Environment secrets from the `e2e-real` environment

To configure the real-backend workflow in GitHub:

1. Repository `Settings`
2. `Environments`
3. Create `e2e-real`
4. Add these `Environment secrets`:
   - `OLLAMA_BASE_URL`
   - `CF_ACCESS_CLIENT_ID`
   - `CF_ACCESS_CLIENT_SECRET`
   - `METRICS_CF_ACCESS_CLIENT_ID` if the metrics route is behind Cloudflare Access
   - `METRICS_CF_ACCESS_CLIENT_SECRET` if the metrics route is behind Cloudflare Access

The real-backend workflow keeps those values out of the repo and passes them into Helm at runtime only.
