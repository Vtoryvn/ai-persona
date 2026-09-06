#!/usr/bin/env bash
set -euo pipefail

# Pre-warm chrome-devtools-mcp so the first mission does not pay npx download cost.
echo "Pre-fetching chrome-devtools-mcp..."
npx --yes chrome-devtools-mcp@latest --version >/dev/null 2>&1 || echo "(prefetch skipped)"

export CHROME_EXECUTABLE="${CHROME_EXECUTABLE:-/usr/bin/google-chrome-stable}"
exec node dist/server.js
