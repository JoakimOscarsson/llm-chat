#!/bin/sh
set -eu

echo "Checking Playwright selectors for ambiguous chat prompt usage..."

if rg -n 'getByLabel\(["'\'']Prompt["'\'']\)' e2e >/tmp/e2e-lint.out 2>/dev/null; then
  echo "Ambiguous Playwright prompt selectors found. Use chatPrompt(page) or an exact textbox selector instead:"
  cat /tmp/e2e-lint.out
  exit 1
fi

if rg -n 'getByRole\(.*name:\s*["'\'']Models["'\'']' e2e >/tmp/e2e-lint.out 2>/dev/null; then
  echo "Ambiguous Playwright model-menu selectors found. Use modelsButton(page) instead:"
  cat /tmp/e2e-lint.out
  exit 1
fi

if rg -n 'getByLabel\(["'\'']Max tokens override["'\'']\)' e2e >/tmp/e2e-lint.out 2>/dev/null; then
  echo "Ambiguous Playwright max-token selectors found. Use maxTokensOverrideInput(page) instead:"
  cat /tmp/e2e-lint.out
  exit 1
fi

echo "E2E selector lint passed."
