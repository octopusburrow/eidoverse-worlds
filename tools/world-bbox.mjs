// world-bbox — measure an entity AS THE CLIENT RENDERS IT: world-space bounding
// box, size, rotY, scale — from a headless spectator, by walking every mesh's
// matrixWorld corners.
//
// Why (2026-09-04): the fold said "there"; the model turned out to be a 24 m
// wall with its origin at one end, and `yaw` is radians (build.js:274). The
// fold proves a verb landed; this proves what a visitor will actually see.
//
//   T=<join token> node tools/world-bbox.mjs [id-regex=gate] [world=staging] [port=8960]
import { chromium } from 'playwright';
const [RX = 'gate', WORLD = 'staging', PORT = '8960'] = process.argv.slice(2); const T = process.env.T || '';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${PORT}/?world=${WORLD}&name=bbox&key=${T}&spectate=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 90000 });
await page.waitForTimeout(35000);
const r = await page.evaluate((RX) => {
  const { scene } = globalThis.EW; const re = new RegExp(RX, 'i'); const hits = [];
  scene.traverse((o) => {
    const id = o.userData?.id || o.userData?.entityId || o.name; if (!re.test(String(id))) return;
    const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9]; let tris = 0; o.updateWorldMatrix(true, true);
    o.traverse((m) => {
      if (!m.isMesh) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; const e = m.matrixWorld.elements;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], w[i]); max[i] = Math.max(max[i], w[i]); }
      }
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    if (tris > 0) hits.push({ id: String(id), tris: Math.round(tris), pos: o.position.toArray().map((v) => +v.toFixed(1)), rotY: +(o.rotation.y * 180 / Math.PI).toFixed(0), scale: +o.scale.x.toFixed(3), size: [0, 1, 2].map((i) => +(max[i] - min[i]).toFixed(1)), min: min.map((v) => +v.toFixed(1)), max: max.map((v) => +v.toFixed(1)) });
  });
  return hits;
}, RX);
await b.close(); console.log(JSON.stringify(r, null, 1));
