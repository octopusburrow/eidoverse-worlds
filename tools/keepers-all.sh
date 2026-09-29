#!/usr/bin/env bash
# Run every keeper proof in tools/*keeper-test.mjs, one at a time, and report
# one line each. Sequential on purpose: the proofs share scratch ports
# (8996/8997) and would collide in parallel. The exit code is the verdict —
# the tests print in four different formats ("N passed", "N OK ·", "ALL OK"),
# and grepping one of them once read a pass as silence (09-17).
# Usage: bash tools/keepers-all.sh [name ...]   (default: all)
set -u
cd "$(dirname "$0")/.."
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for f in tools/*keeper-test.mjs; do n=$(basename "$f" -test.mjs); names+=("$n"); done
fi
red=0
for n in "${names[@]}"; do
  f="tools/$n-test.mjs"
  [ -f "$f" ] || { printf '  ??   %-16s no such test\n' "$n"; red=$((red+1)); continue; }
  # Older proofs expect a server already up, and say so in a usage comment on
  # line 2 ("... PORT=NNNN ... bun server/server.ts &"). Honor it: spawn that
  # server in its own process group, run, kill the group. Newer proofs spawn
  # their own and are left alone.
  spid=""
  if ! grep -q 'spawn("bun"' "$f"; then
    port=$(sed -n 2p "$f" | grep -oE 'PORT=[0-9]+' | cut -d= -f2)
    if [ -n "$port" ]; then
      wdir=$(mktemp -d)
      WORLDS_DIR="$wdir" JOIN_TOKEN=test-door PORT="$port" BHV_TIMER_MIN=1 VERB_RATE=100 \
        setsid bun server/server.ts >/dev/null 2>&1 & spid=$!
      sleep 3.5
    fi
  fi
  out=$(timeout 200 bun "$f" 2>&1); code=$?
  if [ -n "$spid" ]; then kill -- -"$spid" 2>/dev/null; rm -rf "$wdir"; fi
  last=$(printf '%s\n' "$out" | grep -E 'passed|OK|FAILED' | tail -1 | sed 's/^ *//')
  if ! grep -qE 'process\.exit\((fail|fails)' "$f"; then
    printf '  ⚫   %-16s exit %d (%s) — test never fails by design; not a verdict\n' "$n" "$code" "${last:-no summary}"
    continue
  fi
  if [ $code -eq 0 ]; then printf '  🟢   %-16s %s\n' "$n" "${last:-exit 0}"
  else red=$((red+1)); printf '  🔴   %-16s exit %d — %s\n' "$n" "$code" "${last:-no summary}"
       printf '%s\n' "$out" | grep -E '✗|FAIL' | sed 's/^/         /' | head -8; fi
done
[ $red -eq 0 ]
