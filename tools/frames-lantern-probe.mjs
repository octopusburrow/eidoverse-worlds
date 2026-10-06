// frames-lantern-probe — a frame at its DEFAULT place stops above the lantern's resting pill (ui-sweep slice 1, 2026-10-03:
// at 1280x720 / 1000x700 the pill sat over the Settings frame's bottom ~60 px and hid "hear my own mic").
// One viewport per run:  BOOT_CHECK_VIEWPORT=1280x720 bun tools/frames-lantern-probe.mjs
//   default  — Settings (audio tab) shown at its default: bottom above the pill where they share columns (and at a desktop
//              width they MUST share them, or the case tests nothing); no control under the pill, at the top of the pane
//              and scrolled to its bottom; the pane really scrolls; the frame gave up height at the BOTTOM only
//   unpinned — no resting pill: Settings is not shrunk for nothing
//   placed   — a hand-placed Settings keeps its height
// Known limit, not covered: the HINT BAR shares the same band and is not yielded to (it is transient and urgent by design).
// Paths where the pill changes WITHOUT a frame being shown (review 2026-10-06 #1-#3) — each must end clear:
//   esc-esc  — Esc hides the panels and quiets the pill; Esc again re-shows them BEFORE the pill un-quiets
//   repin    — Settings open with the pill unpinned, then the pill is pinned again (and unpinned: grows back)
//   reload   — Settings saved open, page reloaded (its first fit runs before the dock has laid out). NOTE: this one
//              passed on the reviewed commit too (review #3 did not reproduce at 1280x720), so it is a guard never seen red.
//   chat     — chat (the frame the pill dodges) hidden then shown: never left shrunk off its bottom edge
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld();
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));

async function boot(seed, { keep = false } = {}) {
  if (!keep) {
    await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
    await pg.evaluate((seed) => {
      localStorage.clear(); localStorage.setItem('ew-cloud-quality', 'off');
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, seed);
  }
  await pg.goto(`${world.origin}/?world=staging&name=lanternprobe&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(() => { const sp = document.getElementById('splash'); return !sp || sp.classList.contains('gone') || sp.style.display === 'none'; }, null, { timeout: 90000 });
  await pg.waitForTimeout(1200);
}
const show = async (fid) => { await pg.evaluate(async (fid) => { const F = await import('./lib/frames.js'); F.getFrame(fid)?.show(); }, fid); await pg.waitForTimeout(500); };
const hide = async (fid) => { await pg.evaluate(async (fid) => { const F = await import('./lib/frames.js'); F.getFrame(fid)?.hide(); }, fid); await pg.waitForTimeout(300); };
async function audioTab() {
  await pg.evaluate(() => { const fr = document.querySelector('[data-frame="settings"]');
    const tab = [...fr.querySelectorAll('button, [role=tab]')].find((b) => /audio|sound/i.test(b.textContent + (b.title || '') + (b.getAttribute('aria-label') || '')));
    tab?.click(); });
  await pg.waitForTimeout(500);
}
async function measure(fid = 'settings') {
  await pg.mouse.move(1, 1); await pg.waitForTimeout(700);   // the refit is rAF-deferred and place() ticks every 500 ms
  return pg.evaluate((fid) => {
    const fr = document.querySelector(`[data-frame="${fid}"]`); const r = fr.getBoundingClientRect();
    const shown = getComputedStyle(fr).display !== 'none' && r.height > 0;
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
    return { shown, frame: [r.left, r.top, r.right, r.bottom].map(Math.round), bodyH: Math.round(body.getBoundingClientRect().height),
      pill: pillShown ? [p.left, p.top, p.right, p.bottom].map(Math.round) : null, covered: [...covered], scrolled, vh: innerHeight, vw: innerWidth };
  }, fid);
}
// in the bottom band AND sharing columns
const sharesBand = (m) => !!m.pill && m.pill[1] > m.vh * 2 / 3 && m.frame[0] < m.pill[2] && m.pill[0] < m.frame[2];
function clear(tag, m) {
  check(`${tag}: frame shown`, m.shown);
  check(`${tag}: bottom ${m.frame[3]} above pill top ${m.pill?.[1]} (if they share the band)`, !sharesBand(m) || m.frame[3] <= m.pill[1]);
  check(`${tag}: no control under the pill (${JSON.stringify(m.covered)})`, m.covered.length === 0);
}

try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  const desktop = (await pg.evaluate(() => innerWidth)) > 600;

  // default
  await boot({}); await show('settings'); await audioTab();
  const A = await measure();
  console.log('default', JSON.stringify(A));
  check('(setup) the lantern pill rests on screen by default', !!A.pill);
  if (desktop) check('(setup) at a desktop width the pill shares the bottom band with Settings, else this case tests nothing', sharesBand(A));
  clear('default', A);
  check(`default: the audio pane's overflow is scrollable (scrolled ${A.scrolled} px; -1 = no scroller found)`, A.scrolled !== -1);

  // reload with Settings saved open (keeps storage: the show() above saved it open)
  await boot({}, { keep: true });
  const D = await measure();
  console.log('reload', JSON.stringify(D));
  clear('reload (Settings saved open)', D);

  // esc-esc
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(600);
  await pg.keyboard.press('Escape');
  const E = await measure();
  console.log('esc-esc', JSON.stringify(E));
  clear('esc-esc', E);

  // unpinned, then re-pinned with Settings open, then unpinned again
  await boot({ 'ew-lantern-pinned': '0' }); await show('settings'); await audioTab();
  const B = await measure();
  console.log('unpinned', JSON.stringify(B));
  check('(setup) unpinned: no resting pill', !B.pill);
  check(`unpinned: Settings is not shrunk for a pill that isn't there (bottom ${B.frame[3]}, room to ${B.vh - 8})`, B.frame[3] >= B.vh - 8 - 2);
  check(`default: Settings gives up height at the BOTTOM only (top ${A.frame[1]} vs pill-free ${B.frame[1]})`, Math.abs(A.frame[1] - B.frame[1]) <= 1);
  await pg.evaluate(async () => { const L = await import('./lib/lantern.js'); L.setPillPinned(true); });
  const R = await measure();
  console.log('repin', JSON.stringify(R));
  check('(setup) repin: the pill is back', !!R.pill);
  clear('repin', R);
  await pg.evaluate(async () => { const L = await import('./lib/lantern.js'); L.setPillPinned(false); });
  const U = await measure();
  check(`unpin again: Settings grows back to the bottom edge (bottom ${U.frame[3]})`, U.frame[3] >= U.vh - 8 - 2);

  // placed: the pill-free default rect, saved as the owner's own arrangement
  const ver = await pg.evaluate(() => localStorage.getItem('ew-frame-layout-ver'));
  await boot({ 'ew-frame-layout-ver': ver ?? '', 'ew-frame-settings': JSON.stringify({ x: B.frame[0], y: B.frame[1], w: B.frame[2] - B.frame[0], h: B.bodyH, placed: true }) });
  await show('settings');
  const C = await measure();
  console.log('placed', JSON.stringify(C));
  if (desktop) check('(setup) placed: the placed rect really overlaps the pill', sharesBand(C) && C.frame[3] > C.pill[1]);
  check(`placed: a hand-placed Settings keeps its height (body ${C.bodyH} vs unshrunk ${B.bodyH})`, C.bodyH >= B.bodyH - 2);

  // chat: hidden then shown, never stuck shrunk off its bottom edge once the pill has stepped aside
  await boot({}); await hide('chat'); await show('chat'); await pg.waitForTimeout(800);
  const H = await measure('chat');
  console.log('chat', JSON.stringify({ frame: H.frame, pill: H.pill, vh: H.vh }));
  check(`chat: ends on its bottom edge (bottom ${H.frame[3]} vs ${H.vh - 10}±2)`, H.shown && Math.abs(H.frame[3] - (H.vh - 10)) <= 2);

  check(`no page errors (${errs.slice(0, 2).join(' | ')})`, errs.length === 0);
} finally { await browser.close(); await world.close?.(); }
done();
