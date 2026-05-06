#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

CLAUDEVIS_FAKE_CLAUDE=1 CLAUDEVIS_DB=:memory: CLAUDEVIS_PORT=7878 \
  bun packages/server/src/index.ts &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

pnpm --filter @claudevis/web dev
