#!/usr/bin/env bash
set -euo pipefail

MCP_PORT="${MCP_PORT:-9223}"
MCP_VIEWPORT="${MCP_VIEWPORT:-1280x720}"

echo "Starting chrome-devtools-mcp on port ${MCP_PORT}..."
npx --yes chrome-devtools-mcp@latest \
  --http \
  --headless \
  --port "${MCP_PORT}" \
  --viewport "${MCP_VIEWPORT}" &
MCP_PID=$!

cleanup() {
  kill "${MCP_PID}" 2>/dev/null || true
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${MCP_PORT}/health" >/dev/null 2>&1 || \
     curl -sf "http://127.0.0.1:${MCP_PORT}/mcp" >/dev/null 2>&1; then
    echo "MCP ready"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "MCP failed to start" >&2
    exit 1
  fi
done

export MCP_HTTP_URL="http://127.0.0.1:${MCP_PORT}/mcp"
exec node dist/server.js
