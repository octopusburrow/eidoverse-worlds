// fp-nameplate-probe — in desktop first person your own nameplate is hidden with your body, and comes back in third
// person (bug hunt, 2026-09-27: looking up in first person, your own name floated in view). Real client, small owned
// world, clear sky on the off tier (headless-safe). Scroll-zooms in with real wheel events on the canvas.
//   bun tools/fp-nameplate-probe.mjs
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser(); const pg = await page();
const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
try {
  await pg.goto(`${world.origin}/`, { waitUntil: 'domcontentloaded' });
  await pg.evaluate(() => localStorage.setItem('ew-cloud-quality', 'off'));
  await pg.goto(`${world.origin}/?world=staging&name=fpname&key=${world.key}&lite=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  await pg.waitForFunction(async () => !!(await import('./lib/mybody.js')).getMe()?.vrm, null, { timeout: 120000, polling: 1000 });
  const read = () => pg.evaluate(async () => {
    const me = (await import('./lib/mybody.js')).getMe(); const C = await import('./lib/controller.js');
    return { fp: C.firstPerson, body: me.vrm.scene.visible, label: !!me.label?.visible };
  });
  const wheel = (dy) => pg.evaluate((dy) => { const c = globalThis.EW.renderer.domElement;
    for (let i = 0; i < 10; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy / 10, cancelable: true, bubbles: true })); }, dy);
  await pg.waitForTimeout(1500);
  const third = await read();
  await wheel(-2000); await pg.waitForTimeout(800);
  const first = await read();
  await wheel(+2000); await pg.waitForTimeout(800);
  const back = await read();
  console.log('   ', JSON.stringify({ third, first, back }));
  check('(setup) third person shows your body and your nameplate', !third.fp && third.body && third.label, JSON.stringify(third));
  check('(control) zooming in really entered first person: the body is hidden', first.fp && !first.body, JSON.stringify(first));
  check('in first person your own nameplate is hidden too', !first.label, JSON.stringify(first));
  check('zooming back out brings the nameplate back', !back.fp && back.label, JSON.stringify(back));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
} catch (e) { check('probe ran', false, e.message); }
finally { try { await browser.close(); } catch {} try { await world.close(); } catch {} }
done();
