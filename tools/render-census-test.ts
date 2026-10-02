// The render census (render.js) counts renderer.render() calls per XR animation frame. renderCensusTick() runs only
// while presenting (xr.js updateXR), so a count kept on the DESKTOP piled up between sessions and the first VR tick
// folded all of it into `max`: the first [xr:rec] line of every session read max=12928 / 8712 / 299461, then 8-9.
// Real render.js; core.js swapped for a renderer whose presenting flag the test flips.
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/render-census-test.ts
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
const { mock } = await import('bun:test');
const THREE = await import('../client/node_modules/three/build/three.module.js');
const TSL = await import('../client/node_modules/three/build/three.tsl.js');   // warmqueue/materials import TSL from core.js
const base = new URL('../client/lib/', import.meta.url).pathname;
const xr = { isPresenting: false, enabled: false };
const renderer: any = { xr, render() {}, getRenderTarget: () => null, info: { render: { calls: 0 }, memory: {} }, capabilities: {}, extensions: { get: () => null }, getContext: () => null, shadowMap: {}, setPixelRatio() {}, getPixelRatio: () => 1 };
const camera = new THREE.PerspectiveCamera();
mock.module(base + 'core.js', () => ({   // core.js's surface as wing-owner-wire-test lists it, with a renderer we steer
  THREE, TSL, renderer, camera, scene: new THREE.Scene(), canvas: document.createElement('canvas'), report() {},
  sun: new THREE.DirectionalLight(), ground: new THREE.Mesh(), hemi: new THREE.HemisphereLight(), grid: new THREE.Group(), BASE_PIXEL_RATIO: 1,
}));
const R = await import('../client/lib/render.js');
let fail = 0; const check = (n: string, ok: boolean, d: any = '') => { console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : d); if (!ok) fail++; };

const desktop = (n: number) => { xr.isPresenting = false; for (let i = 0; i < n; i++) renderer.render(null, camera); };
const vrFrame = (n: number) => { xr.isPresenting = true; for (let i = 0; i < n; i++) renderer.render(null, camera); R.renderCensusTick(); };
const enter = () => { xr.isPresenting = true; (R as any).renderCensusReset?.(); };

desktop(5000);                       // an evening on the desktop
enter();
check('a session starts with no foreign camera carried over', R.renderCensusPeek() === null);
vrFrame(3);
check('the first VR line counts only that frame (3), not the desktop renders before it', R.renderCensusTake().max === 3, R.renderCensus);
vrFrame(2); vrFrame(9); vrFrame(4);
check('later lines report the busiest frame since the last line (9)', R.renderCensusTake().max === 9);
// a session that ends after an unreported busy frame and mid-frame, then desktop, then a new session
vrFrame(7); xr.isPresenting = true; renderer.render(null, camera); renderer.render(null, camera);
desktop(800);
check('(the last session did leave a foreign camera behind, so the next check means something)', R.renderCensusPeek() !== null);
enter();
check("a new session doesn't inherit the last one's foreign camera", R.renderCensusPeek() === null, R.renderCensusPeek());
vrFrame(2);
check("a second session's first line is its own frame (2): neither the desktop nor the last session's half-frame", R.renderCensusTake().max === 2, R.renderCensus);
check('the desktop never counts while not presenting', (() => { R.renderCensusTake(); desktop(50); xr.isPresenting = true; R.renderCensusTick(); return R.renderCensusTake().max === 0; })());
// The real caller: xr.js must reset when a session starts. Entering XR can't run in this suite, so this binds the call
// site by source (weaker than running it; it does catch the call being dropped or moved before setSession resolves).
{ const src = await Bun.file(new URL('../client/lib/xr.js', import.meta.url)).text();
  const i = src.indexOf('await renderer.xr.setSession(session);'), j = src.indexOf('renderCensusReset()', i);
  check('xr.js resets the census right after setSession resolves (source binding)', i > 0 && j > i && j - i < 400 && !src.slice(i + 39, j).includes('await'), { i, j });
  const e = src.indexOf("tee('[xr] session end — teardown begins')"), k = src.indexOf('renderCensusTake()', e);
  check('xr.js reports the census tail as a session ends (source binding)', e > 0 && k > e && k - e < 500, { e, k }); }
console.log(fail ? `FAIL — ${fail} failed` : 'PASS — all checks'); process.exit(fail ? 1 : 0);
