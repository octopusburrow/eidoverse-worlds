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

// TEST STATUS (2026-08-22, all three paths now fired):
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
  const deadline = Date.now() + c.waitMs;
  let meta = { entityMeta: 0, entities: 0 };
  while (Date.now() < deadline) {
    meta = await page.evaluate(() => {
      const w = window;
      return {
        entityMeta: w.entityMeta ? w.entityMeta.size : (w.world?.entityMeta?.size ?? 0),
        entities: w.entities ? w.entities.size : (w.world?.entities?.size ?? 0),
        doorOpen: !!document.querySelector('#door.scrim.open'),
      };
    }).catch(() => meta);
    if (meta.entityMeta > 0) break;
    await page.waitForTimeout(400);
  }

  if (!meta.entityMeta) {
    const diag = [
      `probe-join: joined nothing after ${c.waitMs}ms (entityMeta=0, entities=${meta.entities}).`,
      doorErrors.length ? `door said: ${doorErrors[0]}` : 'no door error seen on console.',
      meta.doorOpen ? 'the door dialog is OPEN — it swallows all keyboard input.' : '',
      pageErrors.length ? `page errors: ${pageErrors.slice(0, 2).join(' | ')}` : 'no page errors.',
      `url: ${url}`,
      'entityMeta=0 after a long wait is a REJECTED CONNECTION, not an empty world.',
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
