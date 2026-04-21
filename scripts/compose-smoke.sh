#!/usr/bin/env sh
set -eu

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-llm-chat-smoke}"
POSTGRES_PORT="${SMOKE_POSTGRES_PORT:-65432}"
SESSION_SERVICE_PORT="${SMOKE_SESSION_SERVICE_PORT:-64003}"

cleanup() {
  env \
    COMPOSE_PROJECT_NAME="${PROJECT_NAME}" \
    POSTGRES_PORT="${POSTGRES_PORT}" \
    SESSION_SERVICE_PORT="${SESSION_SERVICE_PORT}" \
    docker compose down >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

env \
  COMPOSE_PROJECT_NAME="${PROJECT_NAME}" \
  POSTGRES_PORT="${POSTGRES_PORT}" \
  SESSION_SERVICE_PORT="${SESSION_SERVICE_PORT}" \
  docker compose up -d postgres session-service

attempt=1
max_attempts=30

while [ "${attempt}" -le "${max_attempts}" ]; do
  if curl --fail --silent "http://127.0.0.1:${SESSION_SERVICE_PORT}/health" >/tmp/llm-chat-session-health.json; then
    break
  fi

  sleep 1
  attempt=$((attempt + 1))
done

if [ "${attempt}" -gt "${max_attempts}" ]; then
  echo "Session service did not become healthy during compose smoke test." >&2
  env \
    COMPOSE_PROJECT_NAME="${PROJECT_NAME}" \
    POSTGRES_PORT="${POSTGRES_PORT}" \
    SESSION_SERVICE_PORT="${SESSION_SERVICE_PORT}" \
    docker compose logs --tail=200 postgres session-service >&2
  exit 1
fi

grep -q '"service":"session-service"' /tmp/llm-chat-session-health.json
