// skyfast-test — the ?sky=fast A/B switch (client/lib/skyfast/variant.js) against the REAL virtual file
// layer (client/lib/assets.js Deno shim), with a scripted network. Builds nothing on a GPU.
//
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/skyfast-test.ts
//
// Checks: (i) without ?sky=fast the switch is inert: 'eidoverse/sky_system.js' reads the library's bytes and the
// fast copy is never fetched; (ii) with it, the same path reads the fast copy's bytes and SKYFAST carries the flags,
// and turning it back off restores the original; (iii) flag parsing: defaults all on, `-name` disables, unknowns are
// reported, never applied; (iv) the fast copy on disk declares every flag it is switched by, and the client's
// sky build calls the switch before sky_worlds is loaded (a static tripwire: sky.js is too heavy to import here).
// Every check was watched red on a mutant (see the sky-fast build note).
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
HTMLCanvasElement.prototype.getContext = function () { const a: any = new Proxy(function () {}, { get: (_t, k) => (k === 'width' ? 100 : a), apply: () => a, set: () => true }); return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : a), set: () => true }); } as any;
import { plugin } from 'bun';
import { readFileSync } from 'node:fs';
const HERE = import.meta.dir; const here = (p: string) => `${HERE}/${p.replace(/^\.\//, '')}`;
plugin({ name: 'core-stub', setup(build) {
  build.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
  build.onResolve({ filter: /^\.\/base\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
  build.onResolve({ filter: /^\.\/loadwork\.js$/ }, () => ({ path: here('./loadwork-stub.mjs') }));
} });

// the flags implemented so far (grows one commit at a time)
const GATED: string[] = ['lighttop', 'erosion'];
const ORIG = '/* the library original */';
const FAST = '/* the skyfast copy */';
const calls: string[] = [];
globalThis.fetch = (async (u: any) => {
  const path = String(u);
  calls.push(path);
  const body = path === '/library/eidoverse/sky_system.js' ? ORIG : path === '/lib/skyfast/sky_system_fast.js' ? FAST : null;
  if (body === null) return new Response(null, { status: 404 });
  const b = new TextEncoder().encode(body);
  return new Response(b, { status: 200, headers: { 'content-length': String(b.length) } });
}) as any;

const { primeFiles, primeBytes, aliasDenoFile } = await import('../client/lib/assets.js');
const { prepareSkySystem, parseSkyVariant, SKYFAST_FLAGS, FAST_URL } = await import('../client/lib/skyfast/variant.js');

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, note = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${note ? `  -- ${note}` : ''}`); } };
const read = () => (globalThis as any).Deno.readTextFileSync('eidoverse/sky_system.js');
const env: Record<string, string | undefined> = {};
const fx = { primeBytes, aliasDenoFile, env };

await primeFiles(['eidoverse/sky_system.js']);

console.log('SKYFAST — (i) default is the original, and inert');
{
  for (const search of ['', '?world=x', '?sky=standard', '?skyfast=-loops']) {
    const line = await prepareSkySystem(search, fx);
    check(`${search || '(no query)'}: reads the library bytes`, read() === ORIG, JSON.stringify(read()));
    check(`${search || '(no query)'}: labels "original"`, line === '[sky] sky_system: original', line);
  }
  check('the fast copy was never fetched', !calls.includes(FAST_URL), calls.join(' '));
  check('SKYFAST unset', env.SKYFAST === undefined, String(env.SKYFAST));
}

console.log('SKYFAST — (ii) ?sky=fast reads the fast copy');
{
  const line = await prepareSkySystem('?sky=fast', fx);
  check('reads the fast bytes', read() === FAST, JSON.stringify(read()));
  check('SKYFAST = every flag', env.SKYFAST === SKYFAST_FLAGS.join(','), String(env.SKYFAST));
  check('labelled fast with the flags', line === `[sky] sky_system: fast (flags ${SKYFAST_FLAGS.join(',')})`, line);
  const line2 = await prepareSkySystem('?sky=fast&skyfast=-loops,-powder', fx);
  check('-loops,-powder: SKYFAST drops exactly those', env.SKYFAST === 'lighttop,erosion', String(env.SKYFAST));
  check('-loops,-powder: label says so', line2 === '[sky] sky_system: fast (flags lighttop,erosion) [off: loops,powder]', line2);
  check('fetched once, cached after', calls.filter((c) => c === FAST_URL).length === 1, calls.join(' '));
  await prepareSkySystem('?sky=fast&skyfast=-lighttop,-erosion,-loops,-powder', fx);
  check('all disabled: SKYFAST is the empty string (not unset)', env.SKYFAST === '', JSON.stringify(env.SKYFAST));
  await prepareSkySystem('', fx);
  check('switching back: the original again', read() === ORIG, JSON.stringify(read()));
  check('switching back: SKYFAST unset', env.SKYFAST === undefined, String(env.SKYFAST));
}

console.log('SKYFAST — (iii) flag parsing');
{
  const d = parseSkyVariant('?sky=fast');
  check('defaults: all on, in plan order', JSON.stringify(d.flags) === JSON.stringify(['lighttop', 'erosion', 'loops', 'powder']), JSON.stringify(d.flags));
  const m = parseSkyVariant('?sky=fast&skyfast=-erosion');
  check('-erosion disables only erosion', JSON.stringify(m.flags) === '["lighttop","loops","powder"]', JSON.stringify(m.flags));
  const b = parseSkyVariant('?sky=fast&skyfast=loops');
  check('a bare name is a no-op (still all on)', b.flags.length === 4 && b.unknown.length === 0, JSON.stringify(b));
  const u = parseSkyVariant('?sky=fast&skyfast=-nubis,-loops');
  check('unknown names reported, not applied', JSON.stringify(u.unknown) === '["-nubis"]' && !u.flags.includes('loops') && u.flags.length === 3, JSON.stringify(u));
  check('?sky=FAST (case) is not fast', parseSkyVariant('?sky=FAST').fast === false);
}

console.log('SKYFAST — (iv) static tripwires');
{
  const src = readFileSync(here('../client/lib/skyfast/sky_system_fast.js'), 'utf8');
  const lib = (() => { try { return readFileSync(here('../../eidoverse-video/eidoverse/sky_system.js'), 'utf8'); } catch { return null; } })();
  check('fast copy reads SKYFAST from Deno.env', /Deno\?\.env\?\.get\?\.\('SKYFAST'\)/.test(src));
  for (const f of GATED) check(`fast copy gates on flag '${f}'`, src.includes(`SKYFAST_ON('${f}')`));
  if (lib) check('library original has no SKYFAST (the copy is the only one that changed)', !lib.includes('SKYFAST'));
  const sky = readFileSync(here('../client/lib/sky.js'), 'utf8');
  const iPrep = sky.indexOf('await prepareSkySystem('), iLoad = sky.indexOf("await loadEidoModule('sky_worlds.js')");
  check('sky.js prepares the sky_system before loading sky_worlds', iPrep > 0 && iLoad > iPrep, `${iPrep} / ${iLoad}`);
}

console.log('SKYFAST — (v) lighttop: the skip bound, mirrored in JS (fp64), never skips a tap below the layer top');
{
  // Mirrors sky_system_fast.js lightRay's lighttop bound and atmoHeight (earth mode). This checks the MATH of the
  // bound, not the TSL; the static tripwire below pins the TSL to the same expression.
  const R = 6371000;
  const atmoHeight = (x: number, y: number, z: number) =>
    (y * (y + 2 * R) + x * x + z * z) / (Math.hypot(x, y + R, z) + R);
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const N_LIGHT = 20;
  const table: string[] = [];
  let violations = 0, worst = Infinity;
  for (const [name, start, height] of [['cumulus', 700, 520], ['stratus', 520, 170], ['darkstorm', 500, 650]] as const) {
    const top = start + height;
    const stepL = Math.min(700, Math.max(380, height * 2.2)) / N_LIGHT;
    const row: string[] = [];
    for (const elDeg of [0.5, 3, 10, 20, 30, 45, 60, 75, 89]) {
      let kept = 0, total = 0;
      for (let n = 0; n < 4000; n++) {
        // a sample anywhere in the layer, up to 30 km out (the march's fadeDist range), any azimuth of sun
        const r = 30000 * Math.sqrt(rnd()), th = rnd() * 2 * Math.PI;
        const x = r * Math.cos(th), z = r * Math.sin(th);
        const hTarget = start + rnd() * height;
        // invert atmoHeight for y at this x,z (Newton; atmoHeight ~ y for small offsets)
        let y = hTarget; for (let it = 0; it < 6; it++) y -= atmoHeight(x, y, z) - hTarget;
        const az = rnd() * 2 * Math.PI, el = elDeg * Math.PI / 180;
        const L = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
        const up = [x, y + R, z]; const ul = Math.hypot(...up);
        const Ly = (L[0] * up[0] + L[1] * up[1] + L[2] * up[2]) / ul;
        const h0 = atmoHeight(x, y, z);
        const tLim = Ly > 0.02 ? (top - h0) / Math.max(Ly, 0.02) + stepL : 1e30;
        const j0 = rnd();
        for (let j = 0; j < N_LIGHT; j++) {
          const t = stepL * (j0 + j);
          total++;
          if (t <= tLim) { kept++; continue; }
          const ht = atmoHeight(x + L[0] * t, y + L[1] * t, z + L[2] * t);
          worst = Math.min(worst, ht - top);
          if (ht < top) violations++;
        }
      }
      row.push(`${elDeg}°:${(kept / total).toFixed(2)}`);
    }
    table.push(`      ${name.padEnd(9)} taps kept ${row.join(' ')}`);
  }
  console.log(table.join('\n'));
  check('no skipped tap is below the layer top (4000 samples x 9 sun elevations x 3 layers)', violations === 0, `${violations} violations`);
  check('skipped taps clear the top by a margin (the one-tap slack)', worst > 0, `closest ${worst.toFixed(3)} m`);
  // above the top, the light-march density is bounded by the preset constants: weather x (1 - smoothstep(0.5,1,1)) = 0,
  // so shape = pow(1e-6, 0.3 + 1.5) and density <= largeWeather(<=2) * finalMul * min(5*shape, 1)
  const shapeTop = Math.pow(1e-6, 1.8);
  const maxTau = 20 * 35 * 2 * 0.3 * Math.min(5 * shapeTop, 1);   // 20 taps x stepL<=35 m x lw<=2 x finalMul<=0.3
  check('the optical depth all skipped taps could have carried is < 1e-7', maxTau < 1e-7, maxTau.toExponential(2));
  const fast = readFileSync(here('../client/lib/skyfast/sky_system_fast.js'), 'utf8');
  check('the TSL bound is the mirrored expression', fast.includes('u.cloudStart.add(u.cloudHeight).sub(atmoHeight(p)).div(max(LyTop, 0.02))')
    && fast.includes('T3.select(LyTop.greaterThan(0.02), tTop.add(stepL), float(1e30))')
    && fast.includes('dot(u.cloudLightDir, normalize(p.sub(earthC)))'));
}

if (GATED.includes('erosion')) {
  console.log('SKYFAST — (vi) erosion: the skip is keyed on the factor that zeroes density');
  const fast = readFileSync(here('../client/lib/skyfast/sky_system_fast.js'), 'utf8');
  // density = largeWeather * finalMul * min(den2*5, 1) * strip: skipping den2 is exact only where largeWeather == 0,
  // so the branch must test exactly that factor, and the density must still multiply by it
  check('the erosion fbms run only where largeWeather > 0', fast.includes('If(largeWeather.greaterThan(0), () => { den2v.assign(erosionBody(chv)); });'));
  check('the skipped branch leaves den2 = 0, and density still multiplies by largeWeather',
    fast.includes('const den2v = float(0).toVar();') && fast.includes('density: largeWeather.mul(u.finalMul).mul(min(den2v.mul(5), 1))'));
  check('largeWeather is clamped at 0 (so == 0 wherever coverage < largeT)', /const largeWeather = clamp\(wSampleL\([^\n]*\), 0, 2\);/.test(fast));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
