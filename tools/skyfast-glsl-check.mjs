// skyfast-glsl-check — COMPILE (never link, never draw) GLSL ES 3.00 fragment shaders in headless Chromium's WebGL2,
// to catch what source generation alone cannot: a TSL scoping slip (a temp declared inside an If/Loop block and read
// outside it) generates text happily and only fails in the GLSL compiler. ANGLE validates the whole program at
// glCompileShader; the expensive part on a software GPU (SwiftShader's pipeline JIT) happens at link/draw, which this
// tool never reaches. Still: run it one browser at a time, under perf-guard:
//
//   flock /tmp/claude-1000/probe.lock bash /mnt/c/Users/Claude/code/scripts/perf-guard.sh -t 300 -m 1500 -- \
//     bun tools/skyfast-glsl-check.mjs DIR_OF_GLSL_FILES     (as written by skyfast-shader-size.mjs --dump=DIR)
//
// Prints one line per file (OK / FAIL + the first lines of the info log); exits 1 if any fails.
import { launchBrowser } from './probe-harness.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = process.argv[2];
if (!DIR) { console.log('usage: bun tools/skyfast-glsl-check.mjs DIR'); process.exit(2); }
const files = readdirSync(DIR).filter((f) => f.endsWith('.glsl')).sort();
const { page, close } = await launchBrowser();
let bad = 0;
try {
  const pg = await page();
  await pg.setContent('<!doctype html><title>glsl-check</title>');
  for (const f of files) {
    const src = readFileSync(`${DIR}/${f}`, 'utf8');
    const r = await pg.evaluate((src) => {
      const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
      if (!gl) return { ok: false, log: 'no webgl2' };
      const sh = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      const ok = !!gl.getShaderParameter(sh, gl.COMPILE_STATUS);
      const log = gl.getShaderInfoLog(sh) ?? '';
      gl.deleteShader(sh);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok, log };
    }, src);
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${f}  (${src.length} chars)${r.ok ? '' : `\n      ${r.log.split('\n').slice(0, 6).join('\n      ')}`}`);
  }
} finally { await close(); }
console.log(`${files.length - bad} compiled, ${bad} failed`);
process.exit(bad ? 1 : 0);
