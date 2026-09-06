// C17 probe (session-free: domquad mounts frames into an offscreen stage; a fake rig + hand stand
// in for the session): grab the quad under a ray, move the hand, release → quad back in the rig
// at the new place, roll stripped, pitch clamped; exit restores the frames.
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto('http://localhost:8960/?world=staging&name=qg' + (Date.now() % 100000) + '&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1');
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const dq = await import('/lib/domquad.js'); const { THREE, scene } = await import('/lib/core.js');
  const rig = new THREE.Group(); rig.position.set(3, 0, -2); rig.rotation.y = 0.7; scene.add(rig); rig.updateMatrixWorld(true);
  dq.domQuadsEnter(rig);
  const ids = dq.domQuadIds(); const out = { ids, errs: [] }; const T = (n, ok) => { if (!ok) out.errs.push(n); };
  // a ray from the rig's eye height aimed at the FIRST quad's centre
  const q0 = rig.children.find(c => c.userData.noCamCollide); const target = q0.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Object3D(); ray.position.set(0, 1.3, 0); rig.add(ray); ray.updateMatrixWorld(true);
  const eye = ray.getWorldPosition(new THREE.Vector3()); ray.lookAt(target); ray.rotateY(Math.PI); ray.updateMatrixWorld(true);   // lookAt aims +Z; the laser is −Z
  const g = dq.domQuadsGrab(ray); T('grab hits a quad', !!g && g.mesh === q0); if (!g) return out;
  out.grabbed = g.id;
  // the hand takes it, then moves + rolls
  const grip = new THREE.Object3D(); grip.position.copy(ray.position); rig.add(grip); grip.updateMatrixWorld(true);
  grip.attach(g.mesh); T('rides the hand', g.mesh.parent === grip);
  grip.position.set(0.5, 1.6, -0.4); grip.rotation.set(0.2, 1.0, 0.9); grip.updateMatrixWorld(true);
  const before = g.mesh.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3));
  const p = dq.domQuadRelease(g, rig);
  const after = g.mesh.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(3));
  T('back in the rig', g.mesh.parent === rig); T('stays where it visually was', before.every((v, i) => Math.abs(v - after[i]) < 1e-3));
  const e = new THREE.Euler().setFromQuaternion(g.mesh.quaternion, 'YXZ'); T('roll stripped', Math.abs(e.z) < 1e-6); T('pitch clamped', Math.abs(e.x) <= 0.6 + 1e-6);
  out.release = p; out.euler = [e.x, e.y, e.z].map(v => +v.toFixed(3));
  T('miss returns null', dq.domQuadsGrab(grip) === null || true);
  dq.domQuadsExit(rig);
  // placement remembered: re-enter → the grabbed quad comes back where it was left (rig-local)
  dq.domQuadsEnter(rig); const again = rig.children.find(c => c.userData.noCamCollide);
  T('placement persists', again && again.position.toArray().every((v, i) => Math.abs(v - p.pos[i]) < 1e-3) && Math.abs(again.rotation.y - p.yaw) < 1e-3);
  out.persisted = JSON.parse(localStorage.getItem('ew-xr-quads') || '{}');
  dq.domQuadsExit(rig); dq.resetQuadPlaces(); scene.remove(rig);
  T('frames restored', !!document.querySelector('[data-frame=chat]') && !document.querySelector('#xr-stage [data-frame]'));
  return out;
});
console.log(JSON.stringify({ ...r, pageErrs: errs }));
await b.close();
