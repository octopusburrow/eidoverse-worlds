// skyfast-pixel-diff — a TINY cloud render, original sky_system.js vs the skyfast copy under chosen flags, diffed.
// Headless Chromium here is WebGL2 on SwiftShader (the CPU): a full cloudy sky has OOM-killed this machine, so this
// renders ONLY the cloud dome, at 64x32, 1 march pass, into a float target, with frozen time. The page is served
// from disk through page.route (no server). ALWAYS run it guarded, one browser at a time:
//
//   flock /tmp/claude-1000/probe.lock bash /mnt/c/Users/Claude/code/scripts/perf-guard.sh -t 300 -m 1500 -- \
//     bun tools/skyfast-pixel-diff.mjs [--hours=12,17.6] [--sets=CSV;CSV;...] [--w=64 --h=32 --passes=1]
//
// Per sun time, it renders the original TWICE (a repeatability floor: any difference there is harness noise) and
// the fast copy once per flag set, and prints max |d| and mean |d| over RGBA against the first original render,
// plus the scale (max value) and how many pixels carry cloud (alpha > 0.01) so a blank render cannot pass as "equal".
import { launchBrowser } from './probe-harness.mjs';
import { readFileSync } from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const HOURS = arg('hours', '12,17.6').split(',').map(Number);
const SETS = arg('sets', ';lighttop;erosion;loops;powder;lighttop,erosion,loops').split(';');
const W = Number(arg('w', 64)), H = Number(arg('h', 32)), PASSES = Number(arg('passes', 1));
const HERE = import.meta.dir;
const LIB = process.env.EIDOVERSE_DIR ?? `${HERE}/../../eidoverse-video`;
const ORIGIN = 'http://skyfast.test';
const FILES = {
  '/three.webgpu.js': `${HERE}/../node_modules/three/build/three.webgpu.js`,
  '/three.core.js': `${HERE}/../node_modules/three/build/three.core.js`,
  '/three.tsl.js': `${HERE}/../node_modules/three/build/three.tsl.js`,
  '/original.js': `${LIB}/eidoverse/sky_system.js`,
  '/fast.js': `${HERE}/../client/lib/skyfast/sky_system_fast.js`,
};
const PAGE = `<!doctype html><meta charset=utf-8><title>skyfast-pixel-diff</title>
<script type="importmap">{"imports":{"three/webgpu":"/three.webgpu.js","three/tsl":"/three.tsl.js"}}</script>
<script type="module">
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
globalThis.THREE = Object.assign({}, THREE, TSL);
delete globalThis.THREE.mrt;
globalThis.EANPA_NO_MRT = true;
const env = {};
globalThis.Deno = { env: { get: (k) => env[k] } };
const src = { original: await (await fetch('/original.js')).text(), fast: await (await fetch('/fast.js')).text() };
const renderer = new THREE.WebGPURenderer({ forceWebGL: true, antialias: false });
renderer.setSize(${W}, ${H});
await renderer.init();
globalThis.renderOnce = async (which, flags, hours) => {
  env.SKYFAST = which === 'fast' ? flags : undefined;
  (0, eval)(src[which]);
  const scene = new THREE.Scene();
  const sys = await globalThis.makeSkySystem({ scene, textures: {}, opts: { cloudPasses: ${PASSES}, densityCache: {} } });
  sys.setClouds?.('cumulus');
  sys.setTime?.(hours);
  const dome = scene.children.find((o) => o.renderOrder === -98);
  for (const o of [...scene.children]) if (o !== dome) scene.remove(o);
  // looking up-ish, wide: sky from ~10 deg to overhead, sun side and anti-sun side both in frame
  const cam = new THREE.PerspectiveCamera(110, ${W} / ${H}, 0.5, 20000);
  cam.position.set(0, 2, 0);
  cam.lookAt(new THREE.Vector3(0, 2 + Math.tan(55 * Math.PI / 180), 1));
  cam.updateMatrixWorld();
  sys.update(100, cam);   // frozen, identical time for every render
  const rt = new THREE.RenderTarget(${W}, ${H}, { type: THREE.FloatType, depthBuffer: true });
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, ${W}, ${H});
  renderer.setRenderTarget(null);
  rt.dispose();
  sys.dispose?.();
  return Array.from(px);
};
globalThis.__ready = true;
</script>`;

const { page, close } = await launchBrowser();
let bad = 0;
try {
  const pg = await page();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.route(`${ORIGIN}/**`, (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: PAGE });
    if (FILES[p]) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(FILES[p], 'utf8') });
    return route.fulfill({ status: 404, body: '' });
  });
  await pg.goto(`${ORIGIN}/`);
  await pg.waitForFunction(() => globalThis.__ready === true, null, { timeout: 120000 });
  const stats = (a, b) => {
    let max = 0, sum = 0, scale = 0, cloud = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      scale = Math.max(scale, Math.abs(a[i]));
      if (i % 4 === 3 && a[i] > 0.01) cloud++;
    }
    return { max, mean: sum / a.length, scale, cloud };
  };
  for (const hours of HOURS) {
    const t0 = Date.now();
    const ref = await pg.evaluate(([h]) => globalThis.renderOnce('original', '', h), [hours]);
    const again = await pg.evaluate(([h]) => globalThis.renderOnce('original', '', h), [hours]);
    const s0 = stats(ref, again);
    console.log(`hours ${hours}: original render ${Date.now() - t0} ms x2; cloud px (alpha>0.01) ${s0.cloud}/${W * H}; value scale ${s0.scale.toExponential(3)}`);
    console.log(`  original vs original (floor)        max ${s0.max.toExponential(3)}  mean ${s0.mean.toExponential(3)}`);
    for (const set of SETS) {
      const t1 = Date.now();
      const f = await pg.evaluate(([h, s]) => globalThis.renderOnce('fast', s, h), [hours, set]);
      const s1 = stats(ref, f);
      console.log(`  fast(${(set || 'none').padEnd(28)}) vs original  max ${s1.max.toExponential(3)}  mean ${s1.mean.toExponential(3)}  rel-max ${(s1.max / (s0.scale || 1)).toExponential(2)}  (${Date.now() - t1} ms)`);
    }
    if (errs.length) { bad++; console.log(`  PAGE ERRORS: ${errs.splice(0).join(' | ').slice(0, 1200)}`); }
  }
} finally { await close(); }
process.exit(bad ? 1 : 0);
