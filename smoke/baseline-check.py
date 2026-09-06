#!/usr/bin/env python3
"""Compare a desktop-baseline.mjs run against smoke/desktop-baseline.expected.json.
Yaw / rootY / camYaw / sceneY must match EXACTLY (controller semantics). Positions get a
tolerance: frame.js:70 caps dt at 0.1 s (anti-tunnelling), so when a headless frame takes
longer than that — SwiftShader with several Chromiums sharing the box — each frame
integrates less than its wall time and a fixed 1 s key hold covers less ground (0.23 vs
0.38 m after the same D-hold, 09-06 03:27). The speed lerp itself is dt-scaled. Direction
and rough magnitude are what a regression would break; exact metres are not a property of
the controller under load.
Usage: node smoke/desktop-baseline.mjs "<url>" | tail -1 | python3 smoke/baseline-check.py
"""
import json, sys, math
POS_TOL = 0.3
got = json.loads(sys.stdin.read().strip().splitlines()[-1])
exp = json.load(open(__file__.rsplit('/', 1)[0] + '/desktop-baseline.expected.json'))
bad = []
for k, e in exp.items():
    g = got.get(k)
    if g is None: bad.append(f"{k}: missing"); continue
    for f in ('yaw', 'rootY', 'camYaw', 'sceneY'):
        if e.get(f) != g.get(f): bad.append(f"{k}.{f}: exp {e.get(f)} got {g.get(f)}")
    d = math.dist(e['pos'], g['pos'])
    if d > POS_TOL: bad.append(f"{k}.pos: exp {e['pos']} got {g['pos']} (Δ{d:.2f} m > {POS_TOL})")
if got.get('errs'): bad.append(f"page errors: {got['errs']}")
print("BASELINE OK (yaw exact, pos within %.1f m)" % POS_TOL if not bad else "BASELINE DIFF\n  " + "\n  ".join(bad))
sys.exit(1 if bad else 0)
