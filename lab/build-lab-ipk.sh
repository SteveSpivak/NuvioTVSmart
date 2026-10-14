#!/usr/bin/env bash
# Build "Nuvio Lab": the current checkout packaged under the app id space.nuvio.lab, so it installs
# next to the normal Nuvio (space.nuvio.webos) without replacing it or sharing its data or services.
#   lab/build-lab-ipk.sh            -> prints the .ipk path and its sha256
# The source tree is not modified: ids are rewritten in a temporary copy.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/nuvio-lab-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

rsync -a --exclude node_modules --exclude dist --exclude .cache --exclude .git --exclude '*.ipk' --exclude lab/results "$ROOT/" "$WORK/"
ln -s "$ROOT/node_modules" "$WORK/node_modules"

FILES=(appinfo.json js/platform/webos/webosPluginService.js js/platform/webos/webosCompanionService.js
  services/webos/services.json services/webos/package.json services/webos/src/serverHost.js
  services/webos/plugin/services.json services/webos/plugin/package.json services/webos/plugin/src/index.js
  scripts/package-webos.mjs)
for f in "${FILES[@]}"; do
  [[ -f "$WORK/$f" ]] || { echo "ERROR: expected file missing: $f"; exit 1; }
  perl -pi -e 's/space\.nuvio\.webos/space.nuvio.lab/g' "$WORK/$f"
done
perl -pi -e 's/"title": "Nuvio TV"/"title": "Nuvio Lab"/' "$WORK/appinfo.json"
perl -pi -e 's/^const appName = "Nuvio TV";/const appName = "Nuvio Lab";/' "$WORK/scripts/package-webos.mjs"
grep -q '^const appName = "Nuvio Lab";' "$WORK/scripts/package-webos.mjs" || { echo "ERROR: packager app name not changed"; exit 1; }

# Every remaining reference to the normal app id would make the two apps collide.
if grep -rn "space\.nuvio\.webos" "$WORK/appinfo.json" "$WORK/js" "$WORK/services" "$WORK/scripts/package-webos.mjs"; then
  echo "ERROR: space.nuvio.webos still referenced in the lab copy"
  exit 1
fi
grep -q '"title": "Nuvio Lab"' "$WORK/appinfo.json" || { echo "ERROR: title not changed"; exit 1; }

# Runtime keys: copy nuvio.env.js unchanged from an official Nuvio .ipk of the same version
# (ENV_IPK=<path> ENV_IPK_SHA256=<sha>). Never printed, never committed, deleted with $WORK.
: "${ENV_IPK:?set ENV_IPK to the official NuvioTV-webOS-<version>.ipk}"
: "${ENV_IPK_SHA256:?set ENV_IPK_SHA256 to its published sha256}"
[[ "$(shasum -a 256 "$ENV_IPK" | cut -d' ' -f1)" == "$ENV_IPK_SHA256" ]] || { echo "ERROR: ENV_IPK sha256 mismatch"; exit 1; }
mkdir -p "$WORK/envipk" && (cd "$WORK/envipk" && ar x "$ENV_IPK" && tar xzf data.tar.gz)
ENV_JS="$(find "$WORK/envipk" -name nuvio.env.js -path '*space.nuvio.webos*' | head -1)"
[[ -n "$ENV_JS" ]] || { echo "ERROR: nuvio.env.js not found in ENV_IPK"; exit 1; }

(cd "$WORK" && npm run build >"$WORK/package.log" 2>&1) || { tail -30 "$WORK/package.log"; exit 1; }
cp "$ENV_JS" "$WORK/dist/nuvio.env.js"
(cd "$WORK" && node scripts/package-webos.mjs >>"$WORK/package.log" 2>&1) || { tail -30 "$WORK/package.log"; exit 1; }
cmp -s "$ENV_JS" "$WORK/dist/nuvio.env.js" || { echo "ERROR: packaged nuvio.env.js differs from the official one"; exit 1; }
IPK="$(ls "$WORK"/space.nuvio.lab_*_all.ipk)"
mkdir -p "$ROOT/lab/out"
cp "$IPK" "$ROOT/lab/out/"
OUT="$ROOT/lab/out/$(basename "$IPK")"
echo "IPK $OUT"
echo "SHA256 $(shasum -a 256 "$OUT" | cut -d' ' -f1)"
