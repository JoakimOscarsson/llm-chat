#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Linting GitHub Actions workflows with actionlint..."
docker run --rm \
  -v "${ROOT_DIR}:/repo" \
  -w /repo \
  rhysd/actionlint:1.7.7 \
  -color

echo "Checking pnpm setup declarations against packageManager..."
if grep -R -n -E 'uses: pnpm/action-setup@' "${ROOT_DIR}/.github/workflows" >/dev/null 2>&1; then
  echo "Remove pnpm/action-setup version pins from workflows; package.json already defines pnpm@10.0.0." >&2
  exit 1
fi

echo "Checking workflows that run pnpm also enable Corepack..."
python3 - <<'PY' "${ROOT_DIR}"
from pathlib import Path
import sys

root = Path(sys.argv[1])
failed = False

for path in sorted((root / ".github" / "workflows").glob("*.yml")):
    text = path.read_text()
    if "pnpm " not in text:
        continue
    if "corepack enable" not in text:
        print(f"{path}: runs pnpm commands but does not enable Corepack", file=sys.stderr)
        failed = True

if failed:
    raise SystemExit(1)
PY
