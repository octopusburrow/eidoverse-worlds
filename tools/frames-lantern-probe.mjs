// frames-lantern-probe — a frame at its DEFAULT place stops above the lantern's resting pill (ui-sweep slice 1, 2026-10-03:
// at 1280x720 / 1000x700 the pill sat over the Settings frame's bottom ~40 px and hid "hear my own mic").
// Three cases, one viewport per run:
//   default  — Settings (audio tab) shown at its default: its bottom is above the pill wherever they share columns,
//              and no control in the pane has the pill on its centre point
//   unpinned — no resting pill: Settings keeps its authored height (the rule must not shrink frames for nothing)
//   placed   — a hand-placed Settings that overlaps the pill keeps its height (a placed frame is the owner's decision)
//   BOOT_CHECK_VIEWPORT=1280x720 bun tools/frames-lantern-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld();
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));

async function boot(seed) {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate((seed) => {
    localStorage.clear(); localStorage.setItem('ew-cloud-quality', 'off');
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seed);
  await pg.goto(`${world.origin}/?world=staging&name=lanternprobe&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(() => { const sp = document.getElementById('splash'); return !sp || sp.classList.contains('gone') || sp.style.display === 'none'; }, null, { timeout: 90000 });
  await pg.waitForTimeout(800);
  await pg.evaluate(async () => { const F = await import('./lib/frames.js'); F.getFrame('settings')?.show(); });
  await pg.waitForTimeout(500);
  // the audio tab is where the pill hid real controls
  await pg.evaluate(() => { const fr = document.querySelector('[data-frame="settings"]');
    const tab = [...fr.querySelectorAll('button, [role=tab]')].find((b) => /audio|sound/i.test(b.textContent + (b.title || '') + (b.getAttribute('aria-label') || '')));
    tab?.click(); });
  await pg.waitForTimeout(500);
  await pg.mouse.move(1, 1);
  return pg.evaluate(() => {
    const fr = document.querySelector('[data-frame="settings"]'); const r = fr.getBoundingClientRect();
    const body = fr.querySelector('.fr-body') ?? fr;
    const pill = document.getElementById('lantern-pill'); const p = pill?.getBoundingClientRect();
    const pillShown = !!p && p.width > 0 && getComputedStyle(pill).display !== 'none' && getComputedStyle(pill).visibility !== 'hidden';
    const pane = fr.querySelector('.sec.open') ?? body;
    // only controls whose centre is inside the frame's VISIBLE body: rows scrolled past its bottom are clipped by the
    // scroller (hidden, reachable by scrolling), not covered. Checked at the top AND scrolled to the bottom.
    const covered = new Set(); let scrolled = 0;
    const scroller = [...fr.querySelectorAll('*')].find((n) => /(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1);
    for (const pos of ['top', 'bottom']) {
      if (pos === 'bottom') { if (!scroller) { scrolled = -1; break; } scroller.style.scrollBehavior = 'auto'; scroller.scrollTop = scroller.scrollHeight; scrolled = scroller.scrollTop; }
      const vb = body.getBoundingClientRect();
      for (const el of pane.querySelectorAll('button, input, textarea, select, [role=button], label')) {
        const c = el.getBoundingClientRect(); if (!c.width || !c.height) continue;
        const cx = (c.left + c.right) / 2, cy = (c.top + c.bottom) / 2;
        if (cy < vb.top || cy > vb.bottom || cx < vb.left || cx > vb.right) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && pill && (hit === pill || pill.contains(hit))) covered.add(`${pos}: ` + (el.textContent || el.title || el.tagName).trim().slice(0, 30));
      }
    }
    if (scroller) scroller.scrollTop = 0;
    return { frame: [r.left, r.top, r.right, r.bottom].map(Math.round), bodyH: Math.round(body.getBoundingClientRect().height),
      pill: pillShown ? [p.left, p.top, p.right, p.bottom].map(Math.round) : null, covered: [...covered], scrolled, vh: innerHeight };
  });
}

try {
  const A = await boot({});
  console.log('default', JSON.stringify(A));
  check('(setup) the lantern pill rests on screen by default', !!A.pill);
  const shares = A.pill && A.pill[1] > A.vh * 2 / 3 && A.frame[0] < A.pill[2] && A.pill[0] < A.frame[2];   // a phone rests the pill at the TOP: that's the top-row rule's case
  check(`default: Settings bottom ${A.frame[3]} is above the pill top ${A.pill?.[1]} (or the pill isn't in the bottom band / shares no columns)`, !shares || A.frame[3] <= A.pill[1]);
  check(`default: the audio pane's overflow is scrollable (scrolled ${A.scrolled} px; -1 = no scroller found)`, A.scrolled !== -1);
  check(`default: no audio control has the pill on its centre (covered: ${JSON.stringify(A.covered)})`, A.covered.length === 0);

  const B = await boot({ 'ew-lantern-pinned': '0' });
  console.log('unpinned', JSON.stringify(B));
  check('(setup) unpinned: no resting pill', !B.pill);
  check(`default: Settings gives up height at the BOTTOM only (top ${A.frame[1]} vs pill-free ${B.frame[1]})`, Math.abs(A.frame[1] - B.frame[1]) <= 1);
  check(`unpinned: Settings is not shrunk for a pill that isn't there (bottom ${B.frame[3]}, room to ${B.vh - 8})`,
    B.frame[3] >= B.vh - 8 - 2);

  // placed: the default rect, saved as the owner's own arrangement
  const ver = await pg.evaluate(() => localStorage.getItem('ew-frame-layout-ver'));
  const C = await boot({ 'ew-frame-layout-ver': ver ?? '', 'ew-frame-settings': JSON.stringify({ x: B.frame[0], y: B.frame[1], w: B.frame[2] - B.frame[0], h: B.bodyH, placed: true }) });
  console.log('placed', JSON.stringify(C));
  check(`placed: a hand-placed Settings keeps its height (body ${C.bodyH} vs unshrunk ${B.bodyH})`, C.bodyH >= B.bodyH - 2);

  check(`no page errors (${errs.slice(0, 2).join(' | ')})`, errs.length === 0);
} finally { await browser.close(); await world.close?.(); }
done();
