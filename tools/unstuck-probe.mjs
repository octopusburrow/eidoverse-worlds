// unstuck-probe — /unstuck and /respawn in a real client (BUG-HUNT 2026-09-27 22:20: a reload restored R inside the
// temple roof and nothing could get her out). A closed room is registered through fitStructureBoxes (the path the
// `structure` component uses), the body is put inside it, and the commands are typed into the real chat line.
//   bun tools/unstuck-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=stuck&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(async () => !!(await import('./lib/mybody.js')).getMe()?.vrm, null, { timeout: 120000, polling: 1000 });

  const pos = () => pg.evaluate(async () => { const p = (await import('./lib/controller.js')).myState.pos; return { x: p.x, y: p.y, z: p.z }; });
  const say = (t) => pg.evaluate((t) => {
    const el = document.querySelector('#chatline'); el.value = t; el.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 3 && el.value.trim(); i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const log = document.querySelector('#chatlog'); return { left: el.value, last: log?.lastElementChild?.textContent ?? '' };
  }, t);

  // A closed room under a roof, away from the origin: walls 0..3 m round an interior x 6..10, z -2..2, and a roof
  // slab 3.0..3.3 on top. A body inside is free (nothing overlaps it) but walled in -- the shape a reload through a
  // roof leaves you in. (First version put the body INSIDE a slab; the walk resolver ejected it sideways by itself.)
  const made = await pg.evaluate(async () => {
    const C = await import('./lib/colliders.js');
    C.fitStructureBoxes('room', [
      { x0: 5.7, y0: 0, z0: -2.3, x1: 6, y1: 3, z1: 2.3 }, { x0: 10, y0: 0, z0: -2.3, x1: 10.3, y1: 3, z1: 2.3 },
      { x0: 5.7, y0: 0, z0: -2.3, x1: 10.3, y1: 3, z1: -2 }, { x0: 5.7, y0: 0, z0: 2, x1: 10.3, y1: 3, z1: 2.3 },
      { x0: 5.7, y0: 3, z0: -2.3, x1: 10.3, y1: 3.3, z1: 2.3 },
    ], { position: [0, 0, 0] });
    return C.colliders.has('room#s4');
  });
  check('(setup) a closed room with a roof (top 3.3 m) is registered through fitStructureBoxes', made);

  await pg.evaluate(async () => { (await import('./lib/controller.js')).myState.pos.set(8, 0, 0); });
  await pg.waitForTimeout(1500);
  const stuck = await pos();
  check('(control) the body is really walled in: inside the room and under the roof after 1.5 s',
    stuck.x > 6 && stuck.x < 10 && stuck.z > -2 && stuck.z < 2 && stuck.y < 3, JSON.stringify(stuck));

  const r1 = await say('/unstuck');
  await pg.waitForTimeout(200);
  const after = await pos();
  console.log('   ', JSON.stringify({ stuck, r1, after }));
  check('/unstuck was sent from the chat line (the line cleared)', r1.left.trim() === '', JSON.stringify(r1));
  check('/unstuck puts you ON TOP of the roof you were under', Math.abs(after.y - 3.3) < 0.1 && Math.abs(after.x - stuck.x) < 0.05, JSON.stringify(after));
  await pg.waitForTimeout(1500);
  const settled = await pos();
  check('…and you stay there once gravity has run (1.5 s)', Math.abs(settled.y - 3.3) < 0.1, JSON.stringify(settled));

  const r2 = await say('/unstuck');
  await pg.waitForTimeout(200);
  const again = await pos();
  check('a second /unstuck when not stuck leaves you where you are and says so',
    Math.hypot(again.x - settled.x, again.y - settled.y, again.z - settled.z) < 0.05 && /don.t look stuck/.test(r2.last), JSON.stringify({ again, r2 }));

  const r3 = await say('/respawn');
  await pg.waitForTimeout(1500);
  const home = await pos();
  check('/respawn takes you back to the world\'s start (the origin, on the ground)', Math.hypot(home.x, home.z) < 0.05 && Math.abs(home.y) < 0.6, JSON.stringify({ home, r3 }));
  // limp: a ragdoll copies its body back into myState every frame, so a move made while downed was undone (review of
  // f4bf844). The command must get you up first; then you stay put AND your visible body is where others see you.
  await pg.evaluate(async () => { const C = await import('./lib/controller.js'); C.myState.pos.set(5, 0, 5);
    (await import('./lib/localbody.js')).goLimp(); });
  await pg.waitForTimeout(800);
  const limp = await pg.evaluate(async () => (await import('./lib/localbody.js')).isDowned());
  check('(setup) the body really is limp', limp === true);
  const r4 = await say('/respawn');
  await pg.waitForTimeout(2000);
  const up = await pg.evaluate(async () => { const C = await import('./lib/controller.js'); const me = (await import('./lib/mybody.js')).getMe();
    const L = await import('./lib/localbody.js'); const p = C.myState.pos, q = me.root.position;
    return { pos: { x: p.x, y: p.y, z: p.z }, root: { x: q.x, y: q.y, z: q.z }, downed: L.isDowned() }; });
  check('/respawn while limp: you get up, arrive at the start, and stay there',
    !up.downed && Math.hypot(up.pos.x, up.pos.z) < 0.05, JSON.stringify({ up, r4 }));
  check('…and your visible body is where everyone else sees you (no desync)',
    Math.hypot(up.root.x - up.pos.x, up.root.z - up.pos.z) < 0.05, JSON.stringify(up));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
