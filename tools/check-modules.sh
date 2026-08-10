#!/usr/bin/env bash
# Build every client module INDEPENDENTLY.
#
# 🔴 WHY THIS EXISTS (2026-08-09): `bun build client/main.js` passed green while
# engine-piper.js had a duplicate `const ids` declaration. The bundler tolerated
# it; the browser did not. engines.js deliberately catches import failures so one
# broken engine cannot take the others down — which meant the broken module
# registered nothing, and R got "Known formats: none registered" while importing
# a perfectly good voice. She went looking for a problem with her .onnx file.
#
# A bundle build is NOT a syntax check for the modules inside it. Run this.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
for f in client/lib/*.js client/*.js; do
  [ -e "$f" ] || continue
  if ! out=$(timeout 60 bun build "$f" --target browser --outfile /dev/null 2>&1); then
    echo "  ✗ $f"; echo "$out" | grep -E "^error" | head -3 | sed 's/^/      /'
    fail=1
  elif echo "$out" | grep -q "^error"; then
    echo "  ✗ $f"; echo "$out" | grep -E "^error" | head -3 | sed 's/^/      /'
    fail=1
  fi
done

[ "$fail" = 0 ] && echo "  all modules build independently ✓"
exit $fail
