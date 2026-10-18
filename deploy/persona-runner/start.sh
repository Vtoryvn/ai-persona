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

if [ -n "${BROWSER_PROXY_URL:-}" ]; then
  node /app/deploy/persona-runner/scripts/patch-chrome-prefs.mjs || true
fi

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
    export PERSONA_LOCAL_PROXY_URL="${LOCAL_PROXY}"
  fi
fi

echo "Bootstrapping native persona engine..."
node /app/deploy/persona-runner/scripts/bootstrap-engine.mjs || true
if [ -f /tmp/persona-engine-env.sh ]; then
  # shellcheck disable=SC1091
  source /tmp/persona-engine-env.sh
fi

if [ -f /tmp/persona_cpu_online ]; then
  mount --bind /tmp/persona_cpu_online /sys/devices/system/cpu/online 2>/dev/null || true
  mount --bind /tmp/persona_cpu_online /sys/devices/system/cpu/present 2>/dev/null || true
  mount --bind /tmp/persona_cpu_online /sys/devices/system/cpu/possible 2>/dev/null || true
fi
if [ -f /tmp/persona_cpuinfo ]; then
  mount --bind /tmp/persona_cpuinfo /proc/cpuinfo 2>/dev/null || true
fi
if [ -f /tmp/persona_meminfo ]; then
  mount --bind /tmp/persona_meminfo /proc/meminfo 2>/dev/null || true
fi

node /app/deploy/persona-runner/scripts/stun-responder.mjs &

if [ -n "${TZ:-}" ] && [ -f "/usr/share/zoneinfo/${TZ}" ]; then
  ln -snf "/usr/share/zoneinfo/${TZ}" /etc/localtime || true
  echo "${TZ}" > /etc/timezone || true
fi

PROXY_ARGS=()
WEBRTC_ARGS=()
LANG_ARGS=()
if [ -n "${LOCAL_PROXY}" ]; then
  PROXY_ARGS=(--proxy-server="${LOCAL_PROXY}")
  WEBRTC_ARGS=(
    --webrtc-ip-handling-policy=default_public_interface_only
    --force-webrtc-ip-handling-policy=default_public_interface_only
  )
fi
if [ -n "${CHROME_LANG_FLAG:-}" ]; then
  LANG_ARGS=("${CHROME_LANG_FLAG}")
fi

POS_X=$(( (1920 - SCREEN_W) / 2 ))
POS_Y=$(( (1040 - SCREEN_H) / 2 ))
[ "${POS_X}" -lt 0 ] && POS_X=0
[ "${POS_Y}" -lt 0 ] && POS_Y=0

Xvfb "${DISPLAY}" -screen 0 1920x1080x24 &
openbox &

for _ in $(seq 1 20); do
  if xprop -display "${DISPLAY}" -root >/dev/null 2>&1; then
    xprop -display "${DISPLAY}" -root -f _NET_WORKAREA 32c \
      -set _NET_WORKAREA "0, 0, 1920, 1040, 0, 0, 1920, 1040, 0, 0, 1920, 1040, 0, 0, 1920, 1040" || true
    break
  fi
  sleep 0.25
done

LD_PRELOAD="/usr/local/lib/libpersona_engine.so" google-chrome \
  --no-sandbox \
  --test-type \
  --disable-dev-shm-usage \
  --remote-allow-origins=* \
  --disable-blink-features=AutomationControlled \
  --no-default-browser-check \
  --disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider \
  --password-store=basic \
  --use-gl=angle \
  --use-angle=swiftshader \
  --enable-unsafe-swiftshader \
  --ignore-gpu-blocklist \
  --enable-speech-dispatcher \
  --disable-ipv6 \
  --no-first-run \
  --user-data-dir="${CHROME_PROFILE_DIR}" \
  --remote-debugging-port="${CHROME_DEBUG_PORT}" \
  --window-size="${SCREEN_W},${SCREEN_H}" \
  --window-position="${POS_X},${POS_Y}" \
  "${LANG_ARGS[@]}" \
  "${PROXY_ARGS[@]}" \
  "${WEBRTC_ARGS[@]}" \
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

# With C-level connect() loopback isolation in libpersona_engine.so, Chrome cannot
# port-scan 127.0.0.1:45911 or :6080, so noVNC can run eagerly for live viewing & handoff.
export PERSONA_NOVNC_LAZY="${PERSONA_NOVNC_LAZY:-0}"
RFB_PORT="${X11VNC_RFB_PORT:-45911}"
if [ "${PERSONA_NOVNC_LAZY}" = "0" ]; then
  x11vnc -display "${DISPLAY}" -forever -shared -nopw -listen 127.0.0.1 -rfbport "${RFB_PORT}" &
  /opt/noVNC/utils/novnc_proxy --vnc "127.0.0.1:${RFB_PORT}" --listen "${NOVNC_PORT}" &
  echo "noVNC proxy listening on :${NOVNC_PORT} (eager mode, rfb :${RFB_PORT})"
else
  echo "noVNC lazy — starts on mission pause/handoff (rfb :${RFB_PORT})"
fi
echo "Starting persona runner API..."
exec node dist/server.js
