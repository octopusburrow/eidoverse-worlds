// C18 probe: sender A (?xrsim, fed head/grip/curl) → wire → receiver B re-solves A's body.
// Prints A's local bones + wire, B's remote bones + hand reach error. Run: node smoke/xrwire-probe.mjs
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const KEY = 'EK4sECff0YegRuB2uo5pMpJ5', N = Date.now() % 100000, A = 'xrwA' + N, B = 'xrwB' + N;
const b = await chromium.launch(); const errs = { A: [], B: [] };
const open = async (who, extra) => { const p = await b.newPage({ viewport: { width: 960, height: 540 } }); p.on('pageerror', e => errs[who].push(String(e).slice(0, 140)));
  await p.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
  await p.goto('http://localhost:8960/?world=staging&name=' + (who === 'A' ? A : B) + '&key=' + KEY + '&webgl=1' + extra);
  await p.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
  await p.waitForFunction(async () => { const m = await import('/lib/mybody.js'); return !!m.getMe()?.vrm?.humanoid; }, { timeout: 120000 });
  return p; };
const pa = await open('A', '&xrsim=1'); const pb = await open('B', '');
// A: feed a tracked head (pitched down 0.35, yawed 0.25 beyond the body) + right grip ahead + right index curl
const a1 = await pa.evaluate(async () => {
  const c = await import('/lib/controller.js'), xb = await import('/lib/xrbody.js'), mb = await import('/lib/mybody.js');
  const T = (await import('/lib/core.js')).THREE; const me = mb.getMe(); me.root.updateMatrixWorld(true);
  const facing = me.root.rotation.y + (me.vrm.scene.userData.restYaw ?? 0);
  const p = c.myState.pos; const hq = new T.Quaternion().setFromEuler(new T.Euler(-0.35, facing + Math.PI + 0.25, 0, 'YXZ'));
  xb.xrSimHead([p.x, p.y + 1.5, p.z], hq.toArray());
  const g = new T.Vector3(-0.25, 1.15, 0.35).applyAxisAngle(new T.Vector3(0, 1, 0), facing).add(p);
  xb.xrSimGrip('right', g.toArray(), new T.Quaternion().setFromEuler(new T.Euler(0, facing + Math.PI, 0, 'YXZ')).toArray());
  xb.xrSimCurl('right', { index: 1, grip: 0 });
  await new Promise(r => setTimeout(r, 2500));
  const h = me.vrm.humanoid, q = n => h.getNormalizedBoneNode(n)?.quaternion.toArray().map(v => +v.toFixed(3));
  const hand = h.getNormalizedBoneNode('rightHand').getWorldPosition(new T.Vector3());
  return { wire: xb.xrWire(), dbg: xb.xrBodyDebug(), head: q('head'), neck: q('neck'), idx: q('rightIndexProximal'), handErr: +hand.distanceTo(g).toFixed(3), facing: +facing.toFixed(3) };
});
await pb.waitForTimeout(2500);
const b1 = await pb.evaluate(async (A) => {
  const rm = await import('/lib/remotes.js'); const T = (await import('/lib/core.js')).THREE;
  const r = rm.remotes.get(A); if (!r?.avatar?.vrm) return { noRemote: true, ids: [...rm.remotes.keys()] };
  const s = r.buf[r.buf.length - 1]; const h = r.avatar.vrm.humanoid, q = n => h.getNormalizedBoneNode(n)?.quaternion.toArray().map(v => +v.toFixed(3));
  let handErr = null; if (s?.xr?.r) { const fq = new T.Quaternion(); r.avatar.root.getWorldQuaternion(fq); const rp = r.avatar.root.getWorldPosition(new T.Vector3());
    const tgt = new T.Vector3(s.xr.r[0], s.xr.r[1], s.xr.r[2]).applyQuaternion(fq).add(rp); handErr = +h.getNormalizedBoneNode('rightHand').getWorldPosition(new T.Vector3()).distanceTo(tgt).toFixed(3); }
  return { hasXr: !!s?.xr, xr: s?.xr, hooked: r.avatar.onBeforeVrmUpdate === r.xrHook, xrOn: !!r.xrOn, head: q('head'), neck: q('neck'), idx: q('rightIndexProximal'), handErr, rootYaw: +r.avatar.root.rotation.y.toFixed(3), buf: r.buf.length };
}, A);
console.log(JSON.stringify({ A: a1, B: b1, errs }, null, 1));
await b.close();
