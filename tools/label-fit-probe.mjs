// label-fit-probe — no row label in the World or Settings frames is cut short. A label that ellipsizes ("panel co…", the
// 10-03 ui-sweep's VR finding) says less than its author meant, and the reader can't tell what was lost. Opens every tab
// with a real click (as tools/ui-sweep-probe.mjs on hep/ui-sweep does) and checks each visible text-bearing element whose
// own box clips its text: scrollWidth > clientWidth with overflow hidden / text-overflow ellipsis.
//   BOOT_CHECK_VIEWPORT=1000x700 [LABELFIT_SHOTS=<dir>] bun tools/label-fit-probe.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
// no viewport given: run both widths that have each caught a real cut (desktop 1000x700: the VR sliders; phone 390x844:
// the sky clock), each in its own process (probe-harness reads the viewport at import). Review 10-08: a bare run used to
// check only 1280x720 and passed on the phone bug.
if (!process.env.BOOT_CHECK_VIEWPORT) {
  let bad = 0;
  for (const vp of ['390x844', '1000x700']) {
    console.log(`== ${vp}`);
    const r = spawnSync(process.execPath, [process.argv[1]], { stdio: 'inherit', env: { ...process.env, BOOT_CHECK_VIEWPORT: vp, ...(vp === '390x844' ? { BOOT_CHECK_TOUCH: '1' } : {}) } });
    if (r.status !== 0) bad++;
  }
  process.exit(bad ? 1 : 0);
}
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
if (process.env.LABELFIT_SHOTS) mkdirSync(process.env.LABELFIT_SHOTS, { recursive: true });
const EXPECT_TABS = { world: 8, settings: 4 };   // pinned (review 10-08): a tab that silently fails to open must fail the run
const world = await ownedWorld();
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=labeller&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(() => { const sp = document.getElementById('splash'); return !sp || sp.classList.contains('gone') || sp.style.display === 'none'; }, null, { timeout: 90000 });
  const cut = [];
  let tabsSeen = 0, labelsSeen = 0;
  for (const fid of ['world', 'settings']) {
    await pg.evaluate(async (fid) => { const F = await import('./lib/frames.js'); F.getFrame(fid)?.show(); }, fid);
    await pg.waitForTimeout(400);
    const tabs = await pg.evaluate((fid) => [...document.querySelectorAll(`[data-frame=${fid}] .pf-tab.head`)].map((t) => t.title || t.textContent.trim()), fid);
    check(`(setup) the ${fid} frame has its ${EXPECT_TABS[fid]} tabs`, tabs.length === EXPECT_TABS[fid], JSON.stringify(tabs));
    for (const title of tabs) {
      const ok = await pg.evaluate(([fid, title]) => { const t = [...document.querySelectorAll(`[data-frame=${fid}] .pf-tab.head`)].find((x) => (x.title || x.textContent.trim()) === title); if (!t) return false; t.click(); return true; }, [fid, title]);
      check(`(setup) ${fid}/${title} could be clicked`, ok); if (!ok) continue; tabsSeen++;
      await pg.waitForTimeout(600);
      check(`(setup) ${fid}/${title} opened its pane`, await pg.evaluate((fid) => !!document.querySelector(`[data-frame="${fid}"] .sec.open`), fid));
      if (process.env.LABELFIT_SHOTS) { const f = await pg.$(`[data-frame=${fid}]`); await f.screenshot({ path: `${process.env.LABELFIT_SHOTS}/${fid}-${title.replace(/[^\w-]+/g, '_')}.png` }).catch(() => {}); }
      const found = await pg.evaluate((fid) => {
        const fr = document.querySelector(`[data-frame="${fid}"]`); const pane = fr.querySelector('.sec.open') ?? fr;
        const out = []; let n = 0;
        for (const el of pane.querySelectorAll('*')) {
          if (el.children.length || !el.textContent.trim()) continue;   // leaf text only
          const r = el.getBoundingClientRect(); if (!r.width) continue;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          n++;
          if (el.scrollWidth > el.clientWidth + 1 && (cs.textOverflow === 'ellipsis' || /hidden|clip/.test(cs.overflowX)))
            out.push({ text: el.textContent.trim().slice(0, 40), box: Math.round(el.clientWidth), needs: el.scrollWidth });
        }
        return { out, n };
      }, fid);
      labelsSeen += found.n;
      for (const c of found.out) cut.push({ where: `${fid}/${title}`, ...c });
    }
  }
  console.log(`    ${tabsSeen} tabs, ${labelsSeen} text leaves`);
  for (const c of cut) console.log('    cut:', JSON.stringify(c));
  check('(setup) visited the World and Settings tabs', tabsSeen > 3, tabsSeen);
  check('(setup) saw labels', labelsSeen > 20, labelsSeen);
  check('no row label is cut short in World or Settings', cut.length === 0, JSON.stringify(cut.slice(0, 6)));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
