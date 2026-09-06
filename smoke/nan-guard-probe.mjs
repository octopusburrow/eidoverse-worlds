import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0,120)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set','1'); } catch {} });
await page.goto('http://localhost:8960/?world=staging&name=nanprobe7244&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1');
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForFunction(async () => { const m = await import('/lib/mybody.js'); return !!m.getMe()?.vrm?.humanoid; }, { timeout: 120000 });
await page.waitForTimeout(500);
const r = await page.evaluate(async () => {
  const c = await import('/lib/controller.js');
  const before = { camYaw: c.camYaw, speed: c.myState.speed, pos: c.myState.pos.toArray() };
  c.setCamYaw(NaN); c.myState.speed = NaN; c.myState.pos.set(NaN, 0, NaN);
  const poisoned = { camYaw: c.camYaw, speed: c.myState.speed, pos: c.myState.pos.toArray() };
  await new Promise(r => setTimeout(r, 300));   // let the frame loop run updateMe
  const after = { camYaw: c.camYaw, speed: c.myState.speed, pos: c.myState.pos.toArray() };
  return { before, poisoned, after, cam: [...document.querySelector('canvas') ? [1] : []] };
});
await page.waitForTimeout(300);
const black = await page.evaluate(() => { const cv = document.querySelector('canvas'); return null; });
console.log(JSON.stringify({ ...r, errs }));
await b.close();
