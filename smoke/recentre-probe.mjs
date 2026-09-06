// C15 probe: recentreSolve math in the live module; Settings › VR rows exist; ring entries include recentre.
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto('http://localhost:8960/?world=staging&name=rc' + (Date.now() % 100000) + '&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1');
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const xr = await import('/lib/xr.js');
  const P = Math.PI, near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const out = { errs: [] }, T = (name, ok) => { if (!ok) out.errs.push(name); };
  // standing: head 0.4 m right, 0.3 m back in the playspace → fold xz, no lift, and NO yaw field (the rig is stick-only; Basis)
  let s = xr.recentreSolve({ headLocal: { x: 0.4, y: 1.7, z: 0.3 }, seated: false, standingEyeY: 1.6 });
  T('stand xz', s.x === 0.4 && s.z === 0.3); T('stand no lift', s.y === 0); T('never yaws the rig', !('dyaw' in s));
  // seated: head at 1.2 m, avatar standing eye 1.6 → lift 0.4
  s = xr.recentreSolve({ headLocal: { x: 0.1, y: 1.2, z: -0.1 }, seated: true, standingEyeY: 1.6 });
  T('seated lift', near(s.y, 0.4));
  // seated but no eye known / head garbage → no lift
  T('seated no eye', xr.recentreSolve({ headLocal: { x: 0, y: 1.2, z: 0 }, seated: true, standingEyeY: 0 }).y === 0);
  T('seated bad head', xr.recentreSolve({ headLocal: { x: 0, y: 0.05, z: 0 }, seated: true, standingEyeY: 1.6 }).y === 0);
  T('not presenting → false', xr.recentreXR('probe') === false);
  T('pref default', xr.xrPrefs.seated === false);
  // Settings › VR rows
  const { getFrame } = await import('/lib/frames.js'); const st = getFrame('settings'); st?.show();
  const head = [...document.querySelectorAll('[data-frame=settings] .sec > .head')].find(h => /VR/.test(h.textContent)); out.vrHead = !!head; head?.click(); await new Promise(r => setTimeout(r, 100)); if (!document.querySelector('[data-frame=settings] [data-init]')) head?.click(); await new Promise(r => setTimeout(r, 100));
  const labels = [...document.querySelectorAll('[data-frame=settings] .row, [data-frame=settings] button')].map(n => n.textContent.trim());
  out.hasSeated = labels.some(l => /^seated/.test(l)); out.hasRecentre = labels.some(l => l === 'recentre now');
  out.offset = xr.xrRecentre();
  return out;
});
console.log(JSON.stringify({ ...r, pageErrs: errs }));
await b.close();
