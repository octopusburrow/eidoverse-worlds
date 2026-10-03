// restore-hold-probe — a restored body waits for what it stood on (BUG-HUNT 2026-09-27 22:20, part 2: a reload put R
// back on the temple roof before the roof had a collider; she fell to the terrain and the roof built around her).
// Real client and frame loop: the body is set where a restore puts it, holdRestoredHeight is called the way main.js's
// onRestore calls it, and the roof's collider arrives late through fitStructureBoxes.
//   bun tools/restore-hold-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=restorer&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(async () => !!(await import('./lib/mybody.js')).getMe()?.vrm, null, { timeout: 120000, polling: 1000 });
  const st = () => pg.evaluate(async () => { const C = await import('./lib/controller.js'); const p = C.myState.pos;
    return { x: p.x, y: p.y, z: p.z, holding: C.restoreHolding ? C.restoreHolding() : 'n/a' }; });
  const restoreAt = (x, y, z, ms) => pg.evaluate(async ([x, y, z, ms]) => { const C = await import('./lib/controller.js');
    C.myState.pos.set(x, y, z); if (C.holdRestoredHeight) C.holdRestoredHeight(y, ms); }, [x, y, z, ms]);
  const roof = (id, x) => pg.evaluate(async ([id, x]) => { const L = await import('./lib/colliders.js');
    L.fitStructureBoxes(id, [{ x0: x - 3, y0: 3, z0: -3, x1: x + 3, y1: 3.3, z1: 3 }], { position: [0, 0, 0] }); return L.colliders.has(`${id}#s0`); }, [id, x]);

  // 1. restored on a roof whose collider hasn't arrived yet
  await restoreAt(8, 3.3, 0);
  await pg.waitForTimeout(3000);
  const waiting = await st();
  check('restored onto a not-yet-loaded roof: the body waits at its height instead of falling (3 s)', Math.abs(waiting.y - 3.3) < 0.02 && waiting.holding === true, JSON.stringify(waiting));
  check('(setup) the roof collider arrives late', await roof('roofA', 8));
  await pg.waitForTimeout(1200);
  const landed = await st();
  check('…and when it arrives you are standing ON it, hold released', Math.abs(landed.y - 3.3) < 0.05 && landed.holding === false, JSON.stringify(landed));

  // 2. walking releases the hold (you chose to step off): you fall
  await restoreAt(-8, 3.3, 0);
  await pg.waitForTimeout(500);
  await pg.keyboard.down('KeyW'); await pg.waitForTimeout(600); await pg.keyboard.up('KeyW');
  await pg.waitForTimeout(1500);
  const walked = await st();
  check('moving releases the hold: walking off with nothing there, you fall to the ground', walked.y < 0.6 && walked.holding === false, JSON.stringify(walked));

  // 3. the hold times out: nothing ever arrives
  await restoreAt(0, 3.3, 8, 1500);
  await pg.waitForTimeout(3500);
  const timedOut = await st();
  check('the hold times out: nothing arrives, you fall rather than float forever', timedOut.y < 0.6 && timedOut.holding === false, JSON.stringify(timedOut));

  console.log('   ', JSON.stringify({ waiting, landed, walked, timedOut }));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
