#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
WORK_DIR="${TEMP_DIR}/workspace"

cleanup() {
  rm -rf "${TEMP_DIR}"
}

trap cleanup EXIT INT TERM

mkdir -p "${WORK_DIR}"

tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=coverage \
  --exclude=dist \
  -cf - \
  -C "${ROOT_DIR}" . | tar -xf - -C "${WORK_DIR}"

docker run --rm \
  -v "${WORK_DIR}:/workspace" \
  -w /workspace \
  node:22-alpine \
  sh -lc 'corepack enable && pnpm install --frozen-lockfile=false && sh scripts/coverage-report.sh && chown -R '"$(id -u):$(id -g)"' /workspace'

rm -rf "${ROOT_DIR}/coverage"
cp -R "${WORK_DIR}/coverage" "${ROOT_DIR}/coverage"
