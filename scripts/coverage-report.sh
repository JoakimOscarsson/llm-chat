#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COVERAGE_DIR="${ROOT_DIR}/coverage"

rm -rf "${COVERAGE_DIR}"
mkdir -p "${COVERAGE_DIR}"

run_node_coverage() {
  package_name="$1"
  report_dir="$2"

  echo "Collecting coverage for ${package_name}..."
  corepack pnpm exec c8 \
    --reporter=text-summary \
    --reporter=json-summary \
    --report-dir "${COVERAGE_DIR}/${report_dir}" \
    corepack pnpm --filter "${package_name}" test
}

run_node_coverage "@llm-chat-app/host-metrics-server" "host-metrics-server"
run_node_coverage "@llm-chat-app/api-gateway" "api-gateway"
run_node_coverage "@llm-chat-app/chat-service" "chat-service"
run_node_coverage "@llm-chat-app/metrics-service" "metrics-service"
run_node_coverage "@llm-chat-app/model-service" "model-service"
run_node_coverage "@llm-chat-app/ollama-adapter" "ollama-adapter"
run_node_coverage "@llm-chat-app/session-service" "session-service"

echo "Collecting coverage for @llm-chat-app/web..."
corepack pnpm --filter @llm-chat-app/web exec vitest run \
  --coverage.enabled \
  --coverage.provider=v8 \
  --coverage.reporter=text-summary \
  --coverage.reporter=json-summary \
  --coverage.reportsDirectory="${COVERAGE_DIR}/web"
