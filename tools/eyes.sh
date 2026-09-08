#!/bin/bash
# eyes.sh — ON-DEMAND world snapshots (2026-09-01). Persistent renderers are
# heaters on this hardware (gpu-process spins ~7 cores under SwiftShader
# regardless of page frame rate — web-vr.md 09-01). So: launch, warm, snap, KILL.
#   tools/eyes.sh <follow-id> [view] [world] [outfile]
set -e
FOLLOW=${1:?usage: eyes.sh <follow-id> [view] [world] [outfile]}
VIEW=${2:-third}; WORLD=${3:-staging}; OUT=${4:-/tmp/eyes-$FOLLOW-$VIEW.png}
ORIGIN=${ORIGIN:-http://127.0.0.1:8960}
cd "$(dirname "$0")/.."
JOIN_KEY=$(cat ~/.config/burrow-vault/eido-staging-join-token.txt) node tools/serve-renderer.mjs "$ORIGIN" "$WORLD" > /tmp/eyes-run.log 2>&1 &
RPID=$!
cleanup() { kill $RPID 2>/dev/null; sleep 1; for p in $(pgrep -f 'chromium[_]headless'); do kill $p 2>/dev/null; done; }
trap cleanup EXIT
echo "warming (~90s SwiftShader)..."; sleep 95
for try in 1 2 3; do
  CODE=$(curl -s -o "$OUT" -w '%{http_code}' "$ORIGIN/snap?world=$WORLD&follow=$FOLLOW&view=$VIEW")
  [ "$CODE" = 200 ] && { echo "OK $OUT ($(stat -c%s "$OUT") bytes)"; exit 0; }
  echo "snap try $try: HTTP $CODE — extending warm 30s"; sleep 30
done
echo "FAILED after 3 tries (last HTTP $CODE) — see /tmp/eyes-run.log"; exit 1
