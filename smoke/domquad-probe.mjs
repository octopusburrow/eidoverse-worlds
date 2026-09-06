import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } }); const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto(process.argv[2]); await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 }); await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const dq = await import('/lib/domquad.js'); const xr = await import('/lib/xr.js'); const fr = await import('/lib/frames.js'); const core = await import('/lib/core.js'); const T = core.THREE;
  const rig = xr.xrRig(); dq.domQuadsEnter(rig); await new Promise(r => setTimeout(r, 900));   // let SVG images load + re-raster
  const ids = dq.domQuadIds();
  const stats = ids.map((id) => { const t = dq.domQuadTexture(id); const cv = t.image; if (!cv.width || !cv.height) return { id, w: cv.width, h: cv.height, inkPct: null }; const g = cv.getContext("2d"); const d = g.getImageData(0, 0, cv.width, cv.height).data; let ink = 0, n = 0; const bg = [d[0], d[1], d[2]]; for (let i = 0; i < d.length; i += 16) { n++; if (Math.abs(d[i] - bg[0]) + Math.abs(d[i+1] - bg[1]) + Math.abs(d[i+2] - bg[2]) > 40) ink++; } return { id, w: cv.width, h: cv.height, inkPct: +(100 * ink / n).toFixed(1) }; });
  // click probe: aim a fake ray at the settings frame's first section head; count its handler via the DOM (open class) or a click listener
  const s = fr.getFrame('settings'); const head = s?.el.querySelector('.fr-body .sec .head') ?? s?.el.querySelector('.fr-body button'); let click = null;
  if (head) {
    let fired = 0; head.addEventListener('click', () => fired++, { once: false });
    const fe = s.el.getBoundingClientRect(), he = head.getBoundingClientRect();
    const u = (he.left + he.width / 2 - fe.left) / fe.width, v = (he.top + he.height / 2 - fe.top) / fe.height;
    const q = rig.children.find((o) => o.isMesh && o.material?.map?.dom === s.el); rig.updateWorldMatrix(true, true); q.updateWorldMatrix(true, false);
    // put a fake "ray" object at a point in front of the quad, pointing at the uv's world position
    const target = new T.Vector3((u - 0.5) * q.geometry.parameters.width, (0.5 - v) * q.geometry.parameters.height, 0); q.localToWorld(target);
    const origin = target.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(q.getWorldQuaternion(new T.Quaternion())).multiplyScalar(0.8));
    const ray = new T.Object3D(); ray.position.copy(origin); ray.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), target.clone().sub(origin).normalize()); ray.updateMatrixWorld(true);
    const dist = dq.domQuadsPick(ray, true); await new Promise(r => setTimeout(r, 50));
    click = { headText: head.textContent.trim().slice(0, 20), uv: [+u.toFixed(3), +v.toFixed(3)], dist: dist == null ? null : +dist.toFixed(3), fired };
  }
  const st = dq.domQuadTexture('settings'); const png = st?.image?.toDataURL('image/png') ?? null;
  return { ids, stats, click, png };
});
if (r.png) { const fs = await import('node:fs'); fs.writeFileSync('/tmp/claude-1000/xrsim/domquad-settings.png', Buffer.from(r.png.split(',')[1], 'base64')); } const { png, ...rest } = r; console.log(JSON.stringify({ ...rest, errs })); await b.close();
