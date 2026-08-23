// probe-join.mjs — open a world page and REFUSE to return until the join is proven.
//
// Why this exists (2026-08-22): PROBE-RECIPE.md already documents every trap below,
// correctly and in the right words. It did not stop the traps, because a recipe is a
// drawer: it only helps when you think to open it, and the whole failure mode is not
// thinking of it. On 2026-08-05 a probe passed `?token=` instead of `?key=`, was
// rejected at the door, and reported an empty world for a night. On 2026-08-21 three
// headset sessions tested a build that was never loaded, while the version banner said
// so in plain text.
//
// So this is the same knowledge as a floor rather than a drawer: it runs whether or not
// you remembered it, because it sits on the only path a probe can take to get a page.
//
// Usage:
//   import { openWorld } from './probe-join.mjs';
//   const { page, browser, meta } = await openWorld({ world: 'workbench' });
//   ...                       // you are joined, or this already threw
//   await browser.close();

import { chromium } from 'playwright';

// TEST STATUS (2026-08-23 — BOTH directions now fired, which is the point):
//   ✅ HEALTHY join RETURNS a page (staging :8960, valid key): joined=true, entityMeta=0,
//      no throw. 🔴 This is the test that did not exist on 08-22 and it would have FAILED:
//      the proof read `window.entityMeta`, which is UNDEFINED (world.js exports it as a
//      MODULE binding, never mirrored to window). Every healthy join measured 0 and would
//      have thrown "REJECTED CONNECTION". Verified undefined by grep AND against a live world.
//   ✅ REJECTED join THROWS (same world, deliberately wrong key): net.joined=false.
//   ✅ requireContent throws its own distinct message on a joined-but-empty world.
//   LESSON: a guard tested only against failure is not tested. Ask what it prints when
//   things are FINE, not only when they are broken — both answers have to be right.
//
// TEST STATUS (2026-08-22, the original three paths):
//   ✅ joinUrl() emits `key=`, never `token=`.
//   ✅ the `token=` guard throws before a browser launches.
//   ✅ join-timeout FIRED against a live world (:8960, deliberately wrong key): threw the
//      rejected-at-the-door diagnosis instead of returning a page, and additionally caught
//      the open door dialog.
// ⚠️ ONE CAVEAT from that run: the console-scraping branch (doorErrors, the
//    /bad or missing join token/ regex) did NOT fire — the server does not appear to log
//    that string to the browser console on this path. The rejection was caught by
//    entityMeta=0 + the open door, i.e. the structural check carried it while the
//    string-match contributed nothing. Do not trust doorErrors as the mechanism; it is a
//    nice-to-have. If you ever make it load-bearing, verify it prints first.

const DEFAULTS = {
  base: 'http://127.0.0.1:8940',
  world: 'workbench',
  name: 'probe',
  key: 'workbench-2026',
  waitMs: 12000,
  headless: true,
  args: ['--no-sandbox'],
  expectMarkers: [],   // strings that MUST appear in the served page/bundles
  requireContent: false, // also demand entityMeta>0 (an EMPTY world is a valid join)
};

/** Build the join URL with the correct parameter name. `key`, never `token`. */
export function joinUrl(o = {}) {
  const c = { ...DEFAULTS, ...o };
  const q = new URLSearchParams({ world: c.world, name: c.name, key: c.key });
  for (const [k, v] of Object.entries(o.extra || {})) q.set(k, String(v));
  return `${c.base}/?${q}`;
}

/**
 * Open a world page and prove the join before handing it back.
 * Throws with a diagnosis — never returns a silently-rejected page.
 */
export async function openWorld(o = {}) {
  const c = { ...DEFAULTS, ...o };
  if (o.token !== undefined) {
    throw new Error(
      'probe-join: you passed `token`. The client reads `key` (core.js CONFIG.token ' +
      '<- params.get("key")). A `token=` probe is rejected at the door and the page ' +
      'still loads perfectly — which reads as "empty world", not "rejected".');
  }

  const url = joinUrl(c);
  const browser = await chromium.launch({ headless: c.headless, args: c.args });
  const page = await browser.newPage(o.viewport ? { viewport: o.viewport } : {});

  const pageErrors = [];
  const doorErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => {
    const t = m.text();
    if (/bad or missing join token|join token|rejected/i.test(t)) doorErrors.push(t.slice(0, 200));
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Optional: prove the SERVED page is the build under test, before believing any result.
  if (c.expectMarkers.length) {
    const html = await page.content();
    const missing = c.expectMarkers.filter((m) => !html.includes(m));
    if (missing.length) {
      const body = await page.evaluate(() => document.documentElement.outerHTML.length);
      await browser.close();
      throw new Error(
        `probe-join: served page is missing expected marker(s): ${missing.join(', ')}. ` +
        `Page loaded fine (${body} bytes) — it is simply not the build you think it is. ` +
        `Check the URL's query params and the deployed file before trusting any test.`);
    }
  }

  // The join proof: entityMeta populated. Polled, because warm-up is slow and
  // "not yet" is indistinguishable from "never" without a deadline.
  // 🔴 2026-08-23: the join proof MUST read the MODULES, not window.
  // `entityMeta`/`entities` are module exports of /lib/world.js and are NOT
  // mirrored onto window (verified by grep AND against a live world). The first
  // version of this file polled `window.entityMeta` and therefore measured
  // UNDEFINED on every healthy join — it would have thrown "REJECTED CONNECTION"
  // on a world that was working fine. It was only ever tested against a REJECTED
  // join, where throwing looked correct. A guard that has only been run against
  // failure has not been tested; ask what it prints when things are FINE too.
  //
  // Also: joined-ness and content are DIFFERENT facts. An empty world is a
  // legitimate state (staging routinely has entityMeta=0). Gate on net.joined —
  // the socket handshake — and report content separately.
  const deadline = Date.now() + c.waitMs;
  let meta = { joined: false, entityMeta: 0, entities: 0, doorOpen: false };
  while (Date.now() < deadline) {
    meta = await page.evaluate(async () => {
      const [w, n] = await Promise.all([
        import('/lib/world.js').catch(() => null),
        import('/lib/net.js').catch(() => null),
      ]);
      return {
        joined: !!n?.net?.joined,
        entityMeta: w?.entityMeta?.size ?? 0,
        entities: w?.entities?.size ?? 0,
        doorOpen: !!document.querySelector('#door.scrim.open'),
      };
    }).catch(() => meta);
    if (meta.joined && (meta.entityMeta > 0 || !c.requireContent)) break;
    await page.waitForTimeout(400);
  }

  if (c.requireContent && meta.joined && !meta.entityMeta) {
    await browser.close();
    throw new Error(
      `probe-join: joined the door but the world is EMPTY (entityMeta=0) after ${c.waitMs}ms, ` +
      `and requireContent was set. This is a real join — the world simply has no entities. ` +
      `If that is expected (staging often is), drop requireContent.\n  url: ${url}`);
  }

  if (!meta.joined) {
    const diag = [
      `probe-join: never joined after ${c.waitMs}ms (net.joined=false, entityMeta=${meta.entityMeta}).`,
      doorErrors.length ? `door said: ${doorErrors[0]}` : 'no door error seen on console.',
      meta.doorOpen ? 'the door dialog is OPEN — it swallows all keyboard input.' : '',
      pageErrors.length ? `page errors: ${pageErrors.slice(0, 2).join(' | ')}` : 'no page errors.',
      `url: ${url}`,
      'net.joined=false after a long wait is a REJECTED CONNECTION at the door.',
    ].filter(Boolean).join('\n  ');
    await browser.close();
    throw new Error(diag);
  }

  return { page, browser, meta, url, pageErrors };
}

/** Convenience: run fn against a joined world and always close the browser. */
export async function withWorld(o, fn) {
  const ctx = await openWorld(o);
  try {
    return await fn(ctx);
  } finally {
    await ctx.browser.close();
  }
}
