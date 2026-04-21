#!/usr/bin/env sh
set -eu

IMAGE_TAG="llm-chat-host-metrics:smoke"
HOST_METRICS_PORT="${HOST_METRICS_PORT:-64110}"
CONTAINER_NAME="llm-chat-host-metrics-smoke"

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

docker build \
  --build-arg MOCK_NVIDIA_SMI=1 \
  -f host-metrics-server/Dockerfile \
  -t "${IMAGE_TAG}" \
  .

docker run \
  --name "${CONTAINER_NAME}" \
  -d \
  -p "${HOST_METRICS_PORT}:4010" \
  -e PORT=4010 \
  -e HOST_METRICS_GPU_INDEX=0 \
  -e HOST_METRICS_CMD_TIMEOUT_MS=2000 \
  "${IMAGE_TAG}" >/dev/null

attempt=1
max_attempts=30

while [ "${attempt}" -le "${max_attempts}" ]; do
  if curl --fail --silent "http://127.0.0.1:${HOST_METRICS_PORT}/health" >/tmp/llm-chat-host-metrics-health.json; then
    break
  fi

  sleep 1
  attempt=$((attempt + 1))
done

if [ "${attempt}" -gt "${max_attempts}" ]; then
  echo "Host metrics server did not become healthy during smoke test." >&2
  docker logs "${CONTAINER_NAME}" >&2 || true
  exit 1
fi

grep -q '"service":"host-metrics-server"' /tmp/llm-chat-host-metrics-health.json

curl --fail --silent "http://127.0.0.1:${HOST_METRICS_PORT}/gpu" >/tmp/llm-chat-host-metrics-gpu.json
grep -q '"name":"NVIDIA GeForce RTX 4080 SUPER"' /tmp/llm-chat-host-metrics-gpu.json
