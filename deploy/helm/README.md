# Helm Deployment

This directory contains the Kubernetes Helm packaging for the LLM chat app.

## Validate

Use the bundled validator:

```bash
./deploy/helm/validate.sh
```

It runs `helm dependency build`, `helm lint`, and the required template renders through a Dockerized Helm CLI so a local Helm installation is not required.
