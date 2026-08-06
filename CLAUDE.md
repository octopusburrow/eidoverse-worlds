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
