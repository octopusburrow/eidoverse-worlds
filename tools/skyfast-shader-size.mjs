// skyfast-shader-size — generate the cloud dome's fragment shader SOURCE (GLSL via three's GLSLNodeBuilder and WGSL
// via WGSLNodeBuilder) for Skye's sky_system.js and the skyfast copy, WITHOUT a GPU: no renderer init, no compile, no
// draw. The node graph is built and printed; nothing executes it. Reports char counts per pass count (the tiers:
// 1 = low/off bake, 3 = live 'high' + the balanced default, 8 = the 'medium' bake).
//
//   bun tools/skyfast-shader-size.mjs [--flags='lighttop,erosion,loops,powder;loops;'] [--passes=1,3,8] [--dump=DIR]
//   (--flags takes ';'-separated flag SETS; an empty set = every flag off, which must reproduce the original)
//
// Builder failure is LOUD: three falls back to a blank NodeMaterial on a TSL error and logs it; this tool treats any
// "TSL:" error line, or a fragment shader under 20 kB, as a failed build and exits 1.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const PASSES = arg('passes', '1,3,8').split(',').map(Number);
const SETS = arg('flags', 'lighttop,erosion,loops,powder').split(';');
const DUMP = arg('dump', '');
const HERE = import.meta.dir;
const LIB = process.env.EIDOVERSE_DIR ?? `${HERE}/../../eidoverse-video`;
const SRC = {
  original: readFileSync(`${LIB}/eidoverse/sky_system.js`, 'utf8'),
  fast: readFileSync(`${HERE}/../client/lib/skyfast/sky_system_fast.js`, 'utf8'),
};

globalThis.THREE = Object.assign({}, THREE, TSL);
delete globalThis.THREE.mrt;
globalThis.EANPA_NO_MRT = true;
const env = {};
globalThis.Deno = { env: { get: (k) => env[k] } };
const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };
console.warn = () => {};

// a renderer object only as a host for the builders; never init()ed, never draws
// (one per backend: the WGSL builder asks the WebGPU backend's utils about texture sample counts)
const renderers = {
  glsl: new THREE.WebGPURenderer({ forceWebGL: true, canvas: document.createElement('canvas') }),
  wgsl: new THREE.WebGPURenderer({ canvas: document.createElement('canvas') }),
};
// the only renderer query the builders make here; answered as a WebGPU/WebGL2 desktop would
for (const r of Object.values(renderers)) r.hasFeature = () => true;
const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 10000);

async function build(which, passes, flags) {
  env.SKYFAST = which === 'fast' ? flags : undefined;
  env.TIER = 'balanced';
  (0, eval)(SRC[which]);
  const scene = new THREE.Scene();
  const sys = await globalThis.makeSkySystem({ scene, textures: {}, opts: { cloudPasses: passes, densityCache: {} } });
  const dome = scene.children.find((o) => o.renderOrder === -98);
  if (!dome) throw new Error('no cloud dome');
  const out = {};
  for (const [lang, B] of [['glsl', THREE.GLSLNodeBuilder], ['wgsl', THREE.WGSLNodeBuilder]]) {
    const n0 = errors.length;
    const b = new B(dome, renderers[lang]);
    b.scene = scene; b.camera = camera; b.material = dome.material; b.context.material = dome.material;
    const tb = performance.now();
    b.build();
    const ms = performance.now() - tb;
    const fs = b.fragmentShader ?? '';
    const errs = errors.slice(n0);
    out[lang] = { len: fs.length, errs, fs, ms };
    if (DUMP) { mkdirSync(DUMP, { recursive: true }); writeFileSync(`${DUMP}/${which}${which === 'fast' ? `-${flags || 'none'}` : ''}-p${passes}.${lang}`, fs); }
  }
  sys?.dispose?.();
  return out;
}

// the first build of a session can order a uniform declaration differently; the multiset of lines is the check
const sameLines = (a, b) => a.split('\n').sort().join('\n') === b.split('\n').sort().join('\n');
let bad = 0;
const rows = [];
const ok = (w, r, lang, passes) => {
  if (r[lang].errs.length || r[lang].len < 20000) { bad++; origErr(`BUILD FAILED ${w} p${passes} ${lang}: len ${r[lang].len}; ${r[lang].errs.join(' | ').slice(0, 800)}`); }
};
for (const passes of PASSES) {
  const o = await build('original', passes);
  for (const lang of ['glsl', 'wgsl']) ok('original', o, lang, passes);
  for (const FLAGS of SETS) {
    const f = await build('fast', passes, FLAGS);
    for (const lang of ['glsl', 'wgsl']) {
      ok(`fast(${FLAGS})`, f, lang, passes);
      rows.push(`passes ${passes}  ${lang}  original ${String(o[lang].len).padStart(9)}  fast(${(FLAGS || 'none').padEnd(29)}) ${String(f[lang].len).padStart(9)}  ratio ${(f[lang].len / o[lang].len).toFixed(3)}  build ms ${o[lang].ms.toFixed(0)}->${f[lang].ms.toFixed(0)}${f[lang].fs === o[lang].fs ? '  IDENTICAL' : sameLines(f[lang].fs, o[lang].fs) ? '  SAME LINES (declaration order differs)' : ''}`);
      delete f[lang].fs;
    }
  }
  for (const lang of ['glsl', 'wgsl']) delete o[lang].fs;
}
console.log(rows.join('\n'));
process.exit(bad ? 1 : 0);
