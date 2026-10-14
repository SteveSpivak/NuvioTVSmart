#!/usr/bin/env bash
# Linux (Debian/Ubuntu) setup for the Nuvio perf-lab emulator. Safe to re-run.
#   1. system libraries + Xvfb   2. Chromium 94 snapshot   3. npm ci + unconfigured app build
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# Chromium snapshot 911494 = 94.0.4606.0, the same major version and branch as the TV (94.0.4606.128).
REV=911494
DEST="${CHROMIUM_DIR:-$HERE/.chromium}"

SUDO=""; [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null && SUDO="sudo"
if command -v apt-get >/dev/null; then
  # apt failure must not hide the Chromium download. Restricted Linux
  # workspaces cannot reach Debian mirrors; report that and continue.
  set +e
  $SUDO apt-get update -qq
  apt_update_status=$?
  PKGS="xvfb unzip curl ca-certificates fonts-liberation python3 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libxshmfence1 libgtk-3-0 libx11-xcb1 libxss1"
  $SUDO apt-get install -y -qq --no-install-recommends $PKGS
  apt_install_status=$?
  # Package was renamed on Ubuntu 24.04.
  $SUDO apt-get install -y -qq --no-install-recommends libasound2t64 2>/dev/null || $SUDO apt-get install -y -qq --no-install-recommends libasound2
  set -e
  if [ "$apt_update_status" -ne 0 ] || [ "$apt_install_status" -ne 0 ]; then
    echo "WARNING: apt could not install Xvfb or Chromium libraries (update=$apt_update_status install=$apt_install_status)."
    echo "Continuing so the Chromium 94 download is still attempted."
    echo "If xvfb-run is missing, start the emulator with HEADLESS=1. That is less faithful."
  fi
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node 22 or newer is required (built-in WebSocket). Found: $(node -v 2>/dev/null || echo none)"; exit 1; fi

if [ ! -x "$DEST/chrome-linux/chrome" ]; then
  mkdir -p "$DEST"
  ZIP_URL="https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/$REV/chrome-linux.zip"
  if ! curl -fsSL -o "$DEST/chrome-linux.zip" "$ZIP_URL"; then
    rm -f "$DEST/chrome-linux.zip"
    echo "ERROR: Chromium 94 snapshot download failed: $ZIP_URL"
    echo "storage.googleapis.com is not reachable from every Linux workspace. Do not substitute a newer browser and call it the TV emulator."
    exit 1
  fi
  unzip -q -o "$DEST/chrome-linux.zip" -d "$DEST"
  rm -f "$DEST/chrome-linux.zip"
fi
"$DEST/chrome-linux/chrome" --version

cd "$ROOT"
npm ci --no-audit --no-fund
# No local.properties: the build falls back to local.example.properties (all keys empty).
# Guest mode works without it; TMDB and account features stay off. Never add real keys here.
npm run build

if ! command -v xvfb-run >/dev/null; then
  echo "WARNING: xvfb-run is not installed. Use HEADLESS=1 until a display server is available."
fi

cat <<EOF

Setup done.
  export CHROME="$DEST/chrome-linux/chrome"
  xvfb-run -a -s "-screen 0 1920x1080x24" node lab/emu/start.mjs      # leave running
  CDP_URL=http://127.0.0.1:9222 DEVICE=emu node lab/perf/calibrate.mjs  # prints suggestedThrottle
EOF
