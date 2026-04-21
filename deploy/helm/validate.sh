#!/usr/bin/env sh
set -eu

IMAGE="${HELM_IMAGE:-alpine/helm:3.15.4}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

docker run --rm \
  -v "${ROOT}:/workspace" \
  -w /workspace/deploy/helm/llm-chat \
  --entrypoint /bin/sh \
  "${IMAGE}" \
  -lc '
    helm dependency build &&
    helm lint . &&
    helm template llm-chat . >/tmp/default.yaml &&
    helm template llm-chat . -f values-kind-ci.yaml >/tmp/kind-ci.yaml &&
    helm template llm-chat . --set cloudflareTunnel.enabled=true --set cloudflareTunnel.token=test-token >/tmp/cloudflare.yaml &&
    helm template llm-chat . --set appSecrets.existingSecretName=external-app-secrets >/tmp/external-secrets.yaml &&
    ! grep -q "kind: Job" /tmp/kind-ci.yaml
  '
