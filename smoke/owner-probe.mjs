// Acceptance (b): head yaw +1.0 with root at 0 → vrm.scene yaw chases; root/rig untouched; eyes at HMD; pitch doesn't move body Y.
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto(process.argv[2]); await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForFunction(async () => { const m = await import('/lib/mybody.js'); return !!m.getMe()?.vrm?.humanoid; }, { timeout: 120000 }); await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const c = await import('/lib/controller.js'); const xb = await import('/lib/xrbody.js'); const core = await import('/lib/core.js'); const T = core.THREE; const m = await import('/lib/mybody.js'); const xr = await import('/lib/xr.js');
  const me = m.getMe(); const h = me.vrm.humanoid; c.myState.yaw = 0; const rig = xr.xrRig();
  const eyeW = () => { const le = h.getNormalizedBoneNode('leftEye'), re = h.getNormalizedBoneNode('rightEye'); if (le && re) { const a = le.getWorldPosition(new T.Vector3()), bb = re.getWorldPosition(new T.Vector3()); return a.add(bb).multiplyScalar(0.5); } const hd = h.getNormalizedBoneNode('head'); return hd.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 0.06, 0.10).applyQuaternion(hd.getWorldQuaternion(new T.Quaternion()))); };
  const feed = async (yaw, pitch, ms) => { const q = new T.Quaternion().setFromEuler(new T.Euler(pitch, yaw, 0, 'YXZ')); xb.xrSimHead([0.3, 1.42, -0.2], q.toArray()); await new Promise(r => setTimeout(r, ms)); };
  await feed(0, 0, 1500);
  const s0 = { sceneY: +me.vrm.scene.rotation.y.toFixed(3), rootY: +me.root.rotation.y.toFixed(3), rigY: +rig.rotation.y.toFixed(3), eyeErr: +eyeW().distanceTo(new T.Vector3(0.3, 1.42, -0.2)).toFixed(3), sceneP: me.vrm.scene.position.toArray().map(v => +v.toFixed(3)) };
  await feed(1.0, 0, 2500);
  const s1 = { sceneY: +me.vrm.scene.rotation.y.toFixed(3), rootY: +me.root.rotation.y.toFixed(3), rigY: +rig.rotation.y.toFixed(3), eyeErr: +eyeW().distanceTo(new T.Vector3(0.3, 1.42, -0.2)).toFixed(3), restYaw: me.vrm.scene.userData.restYaw ?? null };
  await feed(1.0, 0.5, 1500);   // camera pitched UP (three camera: +X rotation tilts −Z toward +Y)
  const hb = h.getNormalizedBoneNode('head'); const hf = new T.Vector3(0, 0, 1).applyQuaternion(hb.getWorldQuaternion(new T.Quaternion()));
  const s2 = { sceneY: +me.vrm.scene.rotation.y.toFixed(3), scenePY: +me.vrm.scene.position.y.toFixed(3), eyeErr: +eyeW().distanceTo(new T.Vector3(0.3, 1.42, -0.2)).toFixed(3), headFwdY: +hf.y.toFixed(3), headUp: hf.y > 0.1 };
  const d = xb.xrBodyDebug(); return { s0, s1, s2, look: d.look, ran: d.ran };
});
console.log(JSON.stringify({ ...r, errs })); await b.close();
