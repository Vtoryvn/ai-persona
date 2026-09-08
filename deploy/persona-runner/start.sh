#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
VIEWPORT="${MCP_VIEWPORT:-1280x720}"
SCREEN_W="${VIEWPORT%%x*}"
SCREEN_H="${VIEWPORT##*x}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
CHROME_DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"

echo "Starting desktop stack (${SCREEN_W}x${SCREEN_H}) on ${DISPLAY}..."

Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" &
openbox &
google-chrome \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-first-run \
  --user-data-dir=/tmp/chrome-data \
  --remote-debugging-port="${CHROME_DEBUG_PORT}" \
  --window-size="${SCREEN_W},${SCREEN_H}" \
  about:blank &

echo "Waiting for Chrome remote debugging on :${CHROME_DEBUG_PORT}..."
for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
    echo "Chrome ready."
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  echo "Chrome did not become ready in time." >&2
  exit 1
fi

x11vnc -display "${DISPLAY}" -forever -nopw -listen 0.0.0.0 -rfbport 5900 &
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen "${NOVNC_PORT}" &

echo "noVNC proxy listening on :${NOVNC_PORT}"
echo "Starting persona runner API..."
exec node dist/server.js
