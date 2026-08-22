# Headless probe recipe (read before writing another one)

> **2026-08-22 — you probably don't need to read this.** `tools/probe-join.mjs` now
> enforces everything below at runtime: it builds the URL with `key`, throws if you pass
> `token`, and refuses to return a page whose join it cannot prove. Use
> `openWorld({world:'workbench'})` and the traps cannot silently fire.
> This file is the explanation; the helper is the guard. A recipe only helps when you
> think to open it, and not thinking of it is the entire failure mode.

**The join parameter is `key`, not `token`.**

```
http://127.0.0.1:8940/?world=workbench&name=probe&key=workbench-2026
```

`CONFIG.token` is sourced from `params.get('key')` (client/lib/core.js:44).
A probe passing `?token=` sends an empty join token, the server replies
`{"type":"error","error":"bad or missing join token"}`, and then — this is the
part that cost a night — **the page still loads perfectly.** Modules import,
`document.querySelector` works, no console errors, no page errors. The world is
simply empty, which reads as "the world is empty" rather than "you were
rejected at the door."

Symptom to recognise instantly: `entityMeta.size === 0` and `entities.size === 0`
after a long wait. That is a rejected connection, not an empty world.

Second gate, unrelated: the **door dialog** (`#door.scrim.open`) swallows all
keyboard input while open, because `controller.js` returns early on
`isOverlayOpen()`. A probe that dispatches synthetic keys and sees nothing
happen is probably still at the door. Either answer it or call the module
functions directly.

Third: Chromium **refuses pointer lock from synthetic keypresses**, so
mouselook entry cannot be verified headlessly at all. Test the handler logic
(does it reach `requestPointerLock`?) rather than the lock state.

## Working probe skeleton

```js
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
await p.goto('http://127.0.0.1:8940/?world=workbench&name=probe&key=workbench-2026',
             { waitUntil: 'load' });
await p.waitForTimeout(14000);            // assets are slow; 8s is often too short
const r = await p.evaluate(async () => {
  const w = await import('/lib/world.js');
  if (!w.entityMeta.size) return { joined: false };   // ← check this FIRST
  /* ... */
});
```

Run it from a directory with playwright installed (`code/exultation`), not from
the repo — the repo has no node_modules.
