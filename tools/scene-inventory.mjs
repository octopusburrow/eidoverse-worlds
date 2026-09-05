// scene-inventory — what a headless spectator ACTUALLY has in the scene, measured
// through the call path rather than summary counters.
//
// Why (2026-09-04): renderer.info.render.calls on this engine (three WebGPURenderer
// + WebGLBackend) increments once per backend.beginRender and never resets, and
// info.render.triangles reported 65 with 71k tris loaded — a "Firefox 3.4× draw
// call gap" was that counter sampled over different frame counts. Hook the
// backend; traverse the scene; screenshot what the eyes saw.
//
//   T=<join token> node tools/scene-inventory.mjs [world=staging] [port=8960] [browser=chromium|firefox]
import { chromium, firefox } from 'playwright';
const [world='staging', port='8960', bname='chromium'] = process.argv.slice(2);
const T = process.env.T || ''; const bt = bname === 'firefox' ? firefox : chromium;
const b = await bt.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
await page.goto(`http://127.0.0.1:${port}/?world=${world}&name=inv-${bname}&key=${T}&spectate=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 90000 });
await page.waitForTimeout(30000);
const r = await page.evaluate(async () => {
  const { renderer, scene, camera } = globalThis.EW; const be = renderer.backend;
  let frames = 0; const draws = {}; const ob = be.beginRender.bind(be), od = be.draw.bind(be);
  be.beginRender = rc => { frames++; return ob(rc); };
  be.draw = (ro, info) => { const o = ro.object; const k = (o.name || o.type) + ' | ' + ro.material.type; draws[k] = (draws[k] || 0) + 1; return od(ro, info); };
  await new Promise(r => setTimeout(r, 300)); frames = 0; for (const k in draws) delete draws[k];
  await new Promise(r => setTimeout(r, 2000));
  const perFrame = Object.fromEntries(Object.entries(draws).map(([k, v]) => [k, +(v / Math.max(1, frames)).toFixed(2)]));
  const rows = []; let tri = 0;
  scene.traverse(o => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3; const c = o.isInstancedMesh ? o.count : 1; tri += n * c; rows.push({ name: o.name || o.parent?.name || o.type, tris: Math.round(n), inst: c, mat: o.material?.type, visible: o.visible }); } });
  rows.sort((a, b) => b.tris * b.inst - a.tris * a.inst);
  return { fps: +(frames / 2).toFixed(1), drawsPerFrame: +(Object.values(draws).reduce((a, b) => a + b, 0) / Math.max(1, frames)).toFixed(1), tris: Math.round(tri), meshes: rows.length, top: rows.slice(0, 12), perFrame, cam: camera.position.toArray().map(v => +v.toFixed(1)) };
});
const shot = `/tmp/claude-1000/scene-inventory-${world}-${bname}.png`; await page.screenshot({ path: shot }); await b.close();
console.log(JSON.stringify({ world, browser: bname, ...r, pageerrors: errs, screenshot: shot }, null, 1));
