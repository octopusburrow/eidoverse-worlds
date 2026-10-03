// mods-editor-probe — can a person reach the "+ new mod" editor in the 🧩 mods tab? (BUG-HUNT, R 09-28 23:14: "the mods
// frame won't scroll far enough to reach the name field / source textarea".) Real client, small owned world, the World
// frame at its default size in a 1280x720 window. Scrolling is REAL mouse-wheel input over the pane (scrollIntoView or
// puppeteer's click would scroll containers a person can't). A local mod is added first, as in R's case.
//   BOOT_CHECK_VIEWPORT=1280x720 bun tools/mods-editor-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
// run at a size: BOOT_CHECK_VIEWPORT=1280x720 bun tools/mods-editor-probe.mjs
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
// viewport: the harness reads BOOT_CHECK_VIEWPORT (e.g. 1280x720); default is its authoring viewport
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=modder&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.evaluate(async () => { const M = await import('./lib/mods.js'); await M.modsApi.put({ name: 'probe-mod', source: '// hi', auto: false }); });

  // open World, choose the mods tab (a real click on a visible tab)
  await pg.evaluate(async () => { (await import('./lib/frames.js')).getFrame('world').show(); });
  await pg.waitForTimeout(300);
  const tab = await pg.$('[data-frame=world] .pf-tab.head[title="mods"]');
  check('(setup) the World frame has a mods tab', !!tab);
  await tab.click();
  await pg.waitForTimeout(600);

  // geometry: the frame's visible rect, the target, and who scrolls
  const geo = (sel) => pg.evaluate((sel) => {
    const fr = document.querySelector('[data-frame=world]'), el = document.querySelector(sel);
    if (!fr || !el) return { missing: !el };
    const R = (r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) });
    const fb = fr.querySelector('.fr-body') ?? fr;
    const vis = fb.getBoundingClientRect(), t = el.getBoundingClientRect();
    let sc = null;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY)) { sc = { cls: n.className, top: n.scrollTop, max: n.scrollHeight - n.clientHeight }; break; }
    }
    const inside = t.top >= vis.top - 1 && t.bottom <= vis.bottom + 1 && t.top >= 0 && t.bottom <= innerHeight;
    return { frame: R(vis), target: R(t), scroller: sc, inside };
  }, sel);
  // Chrome's wheel scrolling is SMOOTH: scrollTop keeps moving after the event. Measuring mid-animation once aimed a
  // click where "+ new mod" HAD been, and the trust-all button slid under it (10-03): wait until nothing moves.
  const settle = async () => { let last = null;
    for (let i = 0; i < 40; i++) { await pg.waitForTimeout(50);
      const now = await pg.evaluate(() => [...document.querySelectorAll('[data-frame=world] *')].map((n) => n.scrollTop).join(','));
      if (now === last) return; last = now; } };
  const wheelToReach = async (sel) => {
    for (let i = 0; i < 25; i++) {
      const g = await geo(sel);
      if (g.missing || g.inside) return g;
      await pg.mouse.move((g.frame.left + g.frame.right) / 2, (g.frame.top + g.frame.bottom) / 2);
      await pg.mouse.wheel(0, g.target.top < g.frame.top ? -120 : 120);   // toward the target, either way
      await settle();
    }
    return geo(sel);
  };

  const newBtn = await wheelToReach('[data-frame=world] button[data-new]');
  console.log('    + new mod:', JSON.stringify(newBtn));
  check('"+ new mod" can be scrolled into view with the mouse wheel', newBtn.inside === true, JSON.stringify(newBtn));
  if (newBtn.inside) {
    const b = newBtn.target, cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    const under = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className} data-new=${e.dataset?.new ?? ''} text="${(e.textContent||'').trim().slice(0,40)}" title="${e.title||''}" parent=${e.parentElement?.className} in ${e.closest('[data-frame]')?.dataset.frame}` : null; }, [cx, cy]);
    console.log('    under the click:', under);
    if (process.env.SHOT) {
      const fr = await pg.$('[data-frame=world]'); await fr.screenshot({ path: process.env.SHOT });
      console.log('    shot:', process.env.SHOT, JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll('[data-frame=world] .body button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim().slice(0, 18), Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)]; }))));
    }
    const trustBefore = await pg.evaluate(() => document.querySelector('[data-frame=world] button[data-wworld]')?.textContent.trim());
    await pg.mouse.click(cx, cy);
    await pg.waitForTimeout(300);
    const trustAfter = await pg.evaluate(() => document.querySelector('[data-frame=world] button[data-wworld]')?.textContent.trim());
    console.log('    trust before/after:', JSON.stringify({ trustBefore, trustAfter }));
    check('pressing "+ new mod" never grants trust to the world\'s scripts', trustBefore === trustAfter, JSON.stringify({ trustBefore, trustAfter }));
    await pg.waitForFunction(() => !!document.querySelector('#mod-src'), null, { timeout: 10000 }).catch(() => {});   // the pane re-renders async (listScripts)
    console.log('    after click:', await pg.evaluate(() => ({ editor: !!document.querySelector('#mod-src'), name: !!document.querySelector('#mod-name'), newBtns: document.querySelectorAll('button[data-new]').length })));
  }
  const src = await wheelToReach('#mod-src');
  console.log('    editor:', JSON.stringify(src));
  check('…and the new-mod source editor can be scrolled into view and reached', src.inside === true, JSON.stringify(src));
  const del = await wheelToReach('[data-frame=world] button[data-del="probe-mod"]');
  check('a local mod\'s ✕ (delete) is reachable too', del.inside === true, JSON.stringify(del));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
