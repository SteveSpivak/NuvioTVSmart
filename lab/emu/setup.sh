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
  $SUDO apt-get update -qq
  PKGS="xvfb unzip curl ca-certificates fonts-liberation python3 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libxshmfence1 libgtk-3-0 libx11-xcb1 libxss1"
  $SUDO apt-get install -y -qq --no-install-recommends $PKGS
  # Package was renamed on Ubuntu 24.04.
  $SUDO apt-get install -y -qq --no-install-recommends libasound2t64 2>/dev/null || $SUDO apt-get install -y -qq --no-install-recommends libasound2
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node 22 or newer is required (built-in WebSocket). Found: $(node -v 2>/dev/null || echo none)"; exit 1; fi

if [ ! -x "$DEST/chrome-linux/chrome" ]; then
  mkdir -p "$DEST"
  curl -fsSL -o "$DEST/chrome-linux.zip" "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/$REV/chrome-linux.zip"
  unzip -q -o "$DEST/chrome-linux.zip" -d "$DEST"
  rm -f "$DEST/chrome-linux.zip"
fi
"$DEST/chrome-linux/chrome" --version

cd "$ROOT"
npm ci --no-audit --no-fund
# No local.properties: the build falls back to local.example.properties (all keys empty).
# Guest mode works without it; TMDB and account features stay off. Never add real keys here.
npm run build

cat <<EOF

Setup done.
  export CHROME="$DEST/chrome-linux/chrome"
  xvfb-run -a -s "-screen 0 1920x1080x24" node lab/emu/start.mjs      # leave running
  CDP_URL=http://127.0.0.1:9222 DEVICE=emu node lab/perf/calibrate.mjs  # prints suggestedThrottle
EOF
