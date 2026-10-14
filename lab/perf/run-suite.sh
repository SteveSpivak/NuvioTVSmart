#!/usr/bin/env bash
# One measurement: profile run + trace run + layer count + reports, written to lab/results/<device>/<label>/.
# Same 38-key sequence as every number in lab/README.md. Nuvio must already be on Home with focus in a row.
#   TV:        CDP_URL=http://127.0.0.1:19998 DEVICE=tv  lab/perf/run-suite.sh <label>
#   Emulator:  CDP_URL=http://127.0.0.1:9222  DEVICE=emu lab/perf/run-suite.sh <label>
set -euo pipefail
LABEL="${1:?usage: run-suite.sh <label>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../results/${DEVICE:-tv}/$LABEL"
mkdir -p "$OUT"
cd "$OUT"
MODE='(()=>JSON.stringify({constrained:document.body.classList.contains("performance-constrained"),stored:localStorage.getItem("tvPerfMode"),rows:document.querySelectorAll("#home .home-row").length}))()'
{
  echo "device=${DEVICE:-tv} throttle=${THROTTLE:-} when=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "MODE: $(node "$HERE/probe.mjs" "$MODE")"
  node "$HERE/prof.mjs" "$LABEL" | tail -1
  node "$HERE/trace.mjs" "$LABEL" | tail -1
  echo "LAYERS: $(node "$HERE/layers.mjs" | head -1)"
} | tee summary.txt
python3 "$HERE/prof_report.py" "$LABEL"
python3 "$HERE/trace_report.py" "$LABEL"
# Raw traces and profiles are large; keep them out of git (see .gitignore), keep the reports.
echo "reports: $OUT/prof_$LABEL.txt $OUT/trace_$LABEL.txt"
