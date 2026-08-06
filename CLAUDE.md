# eido workbench (worlds-native) — session context

Lab fork of anima-research/eidoverse-worlds (remotes: `fork`=octopusburrow, `origin`+`upstream`=anima — push to `fork`). Branch `lab-resync`. Upstream PRs go via clean branches off
`upstream/main` (worktree pattern — lab branch carries unmerged extras).
Server: bun --watch on :8940 (auto-reloads; key=workbench-2026), data in
../worlds-data, avatars in ../eidoverse-video/eidoverse/assets/vrms/.

## 🔴 House rules (R's standing orders, 2026-08-06 — these are the job)

1. **Check EVERYTHING visually if it renders.** Code-runs ≠ works. Render it,
   LOOK at the pixels, then claim it. Full discipline + tool map:
   `memory/reference_3d_playbook.md` (probe-pixel, sidebyside, squint, the
   A/B-composite-before-any-quality-claim rule, camera gotchas).
2. **A/B composite before ANY quality claim** (`sidebyside.py`); identify the
   surface before comparing pixels; responsiveness ≠ validity; a test that
   cannot see the reported symptom is a comfort, not a check.
3. **Send R things periodically** while working — renders, composites, short
   verdicts. She wants checkpoints she can eyeball, not a final reveal.
   (`tether-share <file>` or turn-final messages; mid-turn prose never reaches
   the tether.)
4. **Measure before theorizing.** Name the one fact that would discriminate,
   get it, then fix. (Three bugs on 08-05/06 each burned 2+ confident wrong
   theories before someone fetched a fact.)

## 🔔 Session-start ritual (added 08-06 after Mica's pings hit an empty chair)
1. `gh api notifications` — GitHub never pushes to us; poll it or miss reviews.
2. `tail ~/.portal/pings.log` — eidoverse-Discord mentions (portal-listener
   daemon appends; if `pgrep -af portal-listener` is empty, RESTART IT:
   `nohup bun code/scripts/portal-listener.mjs >> /tmp/portal-listener.log 2>&1 &`)
3. Live session: also Monitor the tail of pings.log.

## Handy
- Headless page probes: playwright via `tools/node_modules` symlink
  (SwiftShader: `--use-angle=swiftshader --enable-unsafe-swiftshader`).
- Real-GPU / XR: `tools/vr-lab.mjs` (Windows Chrome over CDP + iwer Quest —
  curl the ws URL, PowerShell CIM to kill chrome.exe, presenting tabs
  throttle timers ~28s/step).
- Render close-ups: exultation/tools/probe-bonepose.mjs pattern (trustworthy);
  shot-tigerbee.mjs had a T-pose artifact 08-06 — verify against a second path.
- Suites: `bun tools/smoke.ts` (85), voice lifecycle 31 / wiring 26.
- Avatars: tune sidecars `<vrm>.tune.json`; converter (basis-key lesson!) in
  /mnt/c/Users/Claude/code/avatar-forge/convert_tigerbee_vrm.py.

## three r186 watch (2026-08-06 — delete this section when done)
Pinned three r185 + a shim: `client/lib/core.js` null-guards
`renderer.xr.foveateBoundTexture` (r185 shipping bug — every WebGL-backend XR
frame throws on a null framebuffer target when no post-processing pass exists;
world freezes, tracking lives; fixed on three dev). When **three ≥ 0.186**:
1. `bun add three@0.186.x` in client/
2. Delete the shim block in core.js (marked "delete when three ≥ r186")
3. Consider retiring the `?xr=1` boot flag for r186's per-session WebGL-XR
   fallback (addons/webxr/WebGLXRFallback.js pattern) — that's the shape the
   upstream #32 VR-entry PR wants.
4. Verify: `node tools/vr-lab.mjs` — 16-pose sweep, loop live, label hidden.
XR entry context: R's headset = Steam Frame → desktop Chrome + SteamVR/OpenXR
stream → always the WebGL fallback path. On-device Frame browser has NO WebXR.
