// C14 probe: fed head LOW (anchor lowers the body) → feet on the floor at ankle height, knees bent;
// then move the root sideways → gait re-plants within a stride. node smoke/footik-probe.mjs
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 960, height: 540 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto('http://localhost:8960/?world=staging&name=foot' + (Date.now() % 100000) + '&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1&xrsim=1');
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForFunction(async () => { const m = await import('/lib/mybody.js'); return !!m.getMe()?.vrm?.humanoid; }, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const c = await import('/lib/controller.js'), xb = await import('/lib/xrbody.js'), mb = await import('/lib/mybody.js'); const T = (await import('/lib/core.js')).THREE;
  const me = mb.getMe(), h = me.vrm.humanoid, W = n => { const bn = h.getNormalizedBoneNode(n); return bn ? bn.getWorldPosition(new T.Vector3()) : null; };
  const facing = me.root.rotation.y + (me.vrm.scene.userData.restYaw ?? 0);
  const eyeRest = (W('leftEye') ?? W('head')).y - me.root.getWorldPosition(new T.Vector3()).y;
  const p = c.myState.pos; const hq = new T.Quaternion().setFromEuler(new T.Euler(0, facing + Math.PI, 0, 'YXZ')).toArray();
  const snap = () => { const fy = me.root.getWorldPosition(new T.Vector3()).y; return { footL: +(W('leftFoot').y - fy).toFixed(3), footR: +(W('rightFoot').y - fy).toFixed(3), kneeL: +h.getNormalizedBoneNode('leftUpperLeg').quaternion.angleTo(new T.Quaternion()).toFixed(3), sceneY: +me.vrm.scene.position.y.toFixed(3), gait: xb.xrGaitDebug(), ankleH: me.vrm.userData.ankleH }; };
  xb.xrSimHead([p.x, p.y + eyeRest, p.z], hq); await new Promise(r => setTimeout(r, 1200)); const tall = snap();         // head AT the avatar's eye: no lift
  xb.xrSimHead([p.x, p.y + eyeRest - 0.20, p.z], hq); await new Promise(r => setTimeout(r, 1200)); const crouch = snap(); // 20 cm lower: knees must bend, feet stay planted
  const before = xb.xrGaitDebug(); p.x += 0.30; xb.xrSimHead([p.x, p.y + eyeRest - 0.20, p.z], hq); await new Promise(r => setTimeout(r, 150)); const mid = snap(); await new Promise(r => setTimeout(r, 900)); const moved = snap();          // sidestep: gait re-plants
  return { eyeRest: +eyeRest.toFixed(3), tall, crouch, before, mid, moved, rootX: +p.x.toFixed(2) };
});
console.log(JSON.stringify({ ...r, errs }));
await b.close();
