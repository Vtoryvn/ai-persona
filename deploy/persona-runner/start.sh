#!/usr/bin/env bash
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
VIEWPORT="${MCP_VIEWPORT:-1280x720}"
SCREEN_W="${VIEWPORT%%x*}"
SCREEN_H="${VIEWPORT##*x}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
CHROME_DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"
CHROME_PROFILE_DIR="${CHROME_USER_DATA_DIR:-/data/chrome-profile}"

echo "Starting desktop stack (${SCREEN_W}x${SCREEN_H}) on ${DISPLAY}..."

mkdir -p "${CHROME_PROFILE_DIR}"

LOCAL_PROXY=""
PROXY_PID=""
if [ -n "${BROWSER_PROXY_URL:-}" ]; then
  PROXY_URL_FILE="/tmp/local-proxy.url"
  rm -f "${PROXY_URL_FILE}"
  echo "Starting local proxy forwarder for upstream proxy..."
  node /app/deploy/persona-runner/scripts/anonymize-proxy.mjs >"${PROXY_URL_FILE}" &
  PROXY_PID=$!
  for _ in $(seq 1 45); do
    if [ -s "${PROXY_URL_FILE}" ]; then
      LOCAL_PROXY="$(head -n1 "${PROXY_URL_FILE}" | tr -d '\r\n')"
      break
    fi
    if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
      echo "Proxy forwarder exited before publishing a local URL." >&2
      break
    fi
    sleep 1
  done
  if [ -z "${LOCAL_PROXY}" ]; then
    echo "WARNING: proxy forwarder failed — continuing without proxy (check BROWSER_PROXY_URL)." >&2
    kill "${PROXY_PID}" 2>/dev/null || true
    PROXY_PID=""
  else
    echo "Local proxy: ${LOCAL_PROXY}"
  fi
fi

PROXY_ARGS=()
if [ -n "${LOCAL_PROXY}" ]; then
  PROXY_ARGS=(--proxy-server="${LOCAL_PROXY}")
fi

Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" &
openbox &
google-chrome \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-first-run \
  --user-data-dir="${CHROME_PROFILE_DIR}" \
  --remote-debugging-port="${CHROME_DEBUG_PORT}" \
  --window-size="${SCREEN_W},${SCREEN_H}" \
  "${PROXY_ARGS[@]}" \
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

# -shared: iframe + tab noVNC cùng lúc không đá nhau (tránh connected/connecting loop)
x11vnc -display "${DISPLAY}" -forever -shared -nopw -listen 0.0.0.0 -rfbport 5900 &
/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen "${NOVNC_PORT}" &

echo "noVNC proxy listening on :${NOVNC_PORT}"
echo "Starting persona runner API..."
exec node dist/server.js
