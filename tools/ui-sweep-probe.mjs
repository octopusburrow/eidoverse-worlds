// ui-sweep-probe — every tab of the World and Settings frames, one window size per run, looking for malformed layouts
// (R, 2026-09-28 23:30: "a bunch of these slightly malformed and not-well-designed menus"). Read-only: it opens tabs
// with real clicks, screenshots each frame, and checks every visible control:
//   unreachable — no scroll position of its scroller puts its centre strip inside the frame's visible body
//   clipped     — it sticks out of the frame's left/right edge (nothing scrolls sideways)
//   overlap     — two controls' boxes intersect (more than 16 px²), neither inside the other
//   covered     — its centre point belongs to something else (only checked where the centre is on screen)
// The mouse is parked in a corner first: a hover tooltip once covered "+ new mod" in a probe screenshot.
//   BOOT_CHECK_VIEWPORT=1280x720 SWEEP_OUT=<dir> bun tools/ui-sweep-probe.mjs (not OUT: eido-probe.sh owns that name)
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const VP = process.env.BOOT_CHECK_VIEWPORT || 'default';
const OUT = `${process.env.SWEEP_OUT || 'ui-sweep'}/${process.env.SWEEP_WORLD ? process.env.SWEEP_WORLD + '-' : ''}${VP}`; mkdirSync(OUT, { recursive: true });
const { check, done } = checker();
// SWEEP_WORLDS_DIR + SWEEP_WORLD: sweep a COPY of a populated world (keep it small: a full Commons Chromium is ~5 GB)
const WNAME = process.env.SWEEP_WORLD || 'staging';
const world = await ownedWorld(process.env.SWEEP_WORLDS_DIR ? { env: { WORLDS_DIR: process.env.SWEEP_WORLDS_DIR } } : {});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
const report = [];
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=${WNAME}&name=sweeper&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.evaluate(async () => { const M = await import('./lib/mods.js'); await M.modsApi.put({ name: 'sweep-mod', source: '// hi', auto: false }); });
  await pg.waitForTimeout(1500);

  const CHECK = (fid) => {
        const fr = document.querySelector(`[data-frame="${fid}"]`), fb = fr.querySelector('.fr-body') ?? fr;
        const vb = fb.getBoundingClientRect();
        const vis = { top: Math.max(vb.top, 0), bottom: Math.min(vb.bottom, innerHeight), left: Math.max(vb.left, 0), right: Math.min(vb.right, innerWidth) };
        const pane = fr.querySelector('.sec.open') ?? fb;
        const name = (el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.placeholder || el.title || el.id || '').trim().slice(0, 28)}"`;
        const ctrls = [...pane.querySelectorAll('button, input, textarea, select, [role=button]')]
          // .dd-native: dropdown.js keeps the real <select> in the DOM under its styled button, on purpose
          .filter((el) => { if (el.classList.contains('dd-native')) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
        const out = [];
        for (const el of ctrls) {
          const r = el.getBoundingClientRect();
          let sc = null;
          for (let n = el.parentElement; n && n !== fr.parentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) { sc = n; break; }
          }
          const cy = (r.top + r.bottom) / 2, half = Math.min(8, r.height / 2);
          let reach;
          if (sc) {
            const sr = sc.getBoundingClientRect();
            const win = { top: Math.max(sr.top, vis.top), bottom: Math.min(sr.bottom, vis.bottom) };
            const max = sc.scrollHeight - sc.clientHeight, st = sc.scrollTop;
            // scrollTop s moves the centre to cy + st - s: need win.top <= cy-half and cy+half <= win.bottom
            const lo = Math.max(0, cy + half + st - win.bottom), hi = Math.min(max, cy - half + st - win.top);
            reach = win.bottom - win.top >= 2 * half && lo <= hi + 0.5;
          } else reach = cy - half >= vis.top - 1 && cy + half <= vis.bottom + 1;
          if (!reach) out.push({ kind: 'unreachable', what: name(el), rect: [r.top, r.bottom, r.left, r.right].map(Math.round), scroller: sc ? sc.className : null });
          if (r.left < vis.left - 1 || r.right > vis.right + 1) out.push({ kind: 'clipped', what: name(el), rect: [r.left, r.right].map(Math.round), frame: [vis.left, vis.right].map(Math.round) });
          const cx = (r.left + r.right) / 2;
          if (cy > vis.top && cy < vis.bottom && cx > vis.left && cx < vis.right) {
            const hit = document.elementFromPoint(cx, cy);
            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) { const h = hit.getBoundingClientRect();
              out.push({ kind: 'covered', what: name(el), at: [cx, cy].map(Math.round), by: name(hit), byFrame: hit.closest('[data-frame]')?.dataset.frame ?? hit.closest('[class]')?.className?.toString().slice(0, 30), byRect: [h.top, h.bottom, h.left, h.right].map(Math.round) }); }
          }
        }
        for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
          const a = ctrls[i], b = ctrls[j]; if (a.contains(b) || b.contains(a)) continue;
          const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
          const w = Math.min(A.right, B.right) - Math.max(A.left, B.left), h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (w > 0 && h > 0 && w * h > 16) out.push({ kind: 'overlap', what: `${name(a)} × ${name(b)}`, px: Math.round(w * h) });
        }
        out.push({ kind: 'info', controls: ctrls.length });
        return out;
      };
  for (const fid of ['world', 'settings']) {
    await pg.evaluate(async (fid) => { const F = await import('./lib/frames.js'); const f = F.getFrame(fid); f?.show(); }, fid);
    await pg.waitForTimeout(400);
    await pg.mouse.move(1, 1); await pg.screenshot({ path: `${OUT}/${fid}-WINDOW.png` });
    const tabs = await pg.evaluate((fid) => [...document.querySelectorAll(`[data-frame=${fid}] .pf-tab.head`)].map((t) => t.title || t.textContent.trim()), fid);
    check(`(setup) the ${fid} frame has tabs`, tabs.length > 0, JSON.stringify(tabs));
    for (const title of tabs) {
      const head = await pg.evaluate(([fid, title]) => { const t = [...document.querySelectorAll(`[data-frame=${fid}] .pf-tab.head`)].find((x) => (x.title || x.textContent.trim()) === title);
        const r = t.getBoundingClientRect(); const e = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        const strip = t.parentElement, sx = strip && getComputedStyle(strip).overflowX;
        return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, onScreen: r.width > 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0, hit: !!e && (e === t || t.contains(e)),
          by: e && !(e === t || t.contains(e)) ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)} "${(e.textContent || e.title || '').trim().slice(0, 24)}" in ${e.closest('[data-frame]')?.dataset.frame ?? e.closest('[id]')?.id}` : null,
          stripScrolls: !!strip && /(auto|scroll)/.test(sx) && strip.scrollWidth > strip.clientWidth + 1 }; }, [fid, title]);
      const row = { frame: fid, tab: title, defects: [] };
      if (!head.onScreen || !head.hit) { row.defects.push({ kind: 'tab-unreachable', what: `tab "${title}"`, ...head }); report.push(row); continue; }
      await pg.mouse.click(head.x, head.y);
      await pg.mouse.move(1, 1);
      await pg.waitForTimeout(900);
      const fr = await pg.$(`[data-frame=${fid}]`);
      const shot = `${OUT}/${fid}-${title.replace(/[^\w-]+/g, '_')}.png`;
      try { await fr.screenshot({ path: shot }); row.shot = shot; } catch (e) { row.defects.push({ kind: 'screenshot-failed', what: String(e).slice(0, 80) }); }
      row.defects.push(...await pg.evaluate(CHECK, fid));
      report.push(row);
    }
  }
  // ── phase 2: every OTHER frame the client registers (the rail's windows), one at a time, the rest hidden
  const others = await pg.evaluate(async () => (await import('./lib/frames.js')).allFrames().map((f) => f.id ?? f.el?.dataset?.frame).filter(Boolean));
  const ids = others.filter((id) => id !== 'world' && id !== 'settings');
  check('(setup) found other frames to sweep', ids.length > 0, JSON.stringify(others));
  for (const id of ids) {
    const shown = await pg.evaluate(async (id) => { const F = await import('./lib/frames.js');
      for (const f of F.allFrames()) try { f.hide?.(); } catch {}
      const f = F.getFrame(id); try { f.show(); } catch { return false; }
      return !!document.querySelector(`[data-frame="${id}"]`)?.getBoundingClientRect().width; }, id);
    const row = { frame: id, tab: '(frame)', defects: [] };
    if (!shown) { row.defects.push({ kind: 'info', note: 'did not show (may need context, e.g. a person to whisper)' }); report.push(row); continue; }
    await pg.mouse.move(1, 1); await pg.waitForTimeout(700);
    const shot = `${OUT}/frame-${id.replace(/[^\w-]+/g, '_')}.png`;
    try { await (await pg.$(`[data-frame="${id}"]`)).screenshot({ path: shot }); row.shot = shot; } catch {}
    row.defects.push(...await pg.evaluate(CHECK, id));
    report.push(row);
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  const bad = report.flatMap((r) => r.defects.filter((d) => d.kind !== 'info').map((d) => ({ tab: `${r.frame}/${r.tab}`, ...d })));
  console.log(`    ${VP}: ${report.length} tabs, ${bad.length} findings`);
  for (const b of bad) console.log('   ', JSON.stringify(b).slice(0, 300));
  check('(setup) the sweep visited every tab', report.length > 0);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
