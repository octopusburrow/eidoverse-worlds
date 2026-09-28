// skyfast/variant.js — which sky_system.js the sky evaluates: Skye's original
// (the default) or the A/B copy in ./sky_system_fast.js (`?sky=fast`).
//
// Pure except for the three injected effects, so the node suite can drive the
// real decision against the real virtual file layer (tools/skyfast-test.ts):
//   primeBytes(key, url)   put the fast copy's bytes into the Deno virtual FS
//   aliasDenoFile(from, to) make reads of `from` answer with `to`'s bytes
//                           (to = null clears the alias)
//   env                     the Deno.env backing object (globalThis.__ewEnv)
//
// sky_worlds.js evals `Deno.readTextFileSync('eidoverse/sky_system.js')` on
// every makeSky, so the alias is the whole switch: no edit to Skye's files, and
// without ?sky=fast nothing here fetches or aliases anything.

export const SKY_SYSTEM_PATH = 'eidoverse/sky_system.js';
// the virtual-FS key the fast bytes live under (outside eidoverse/, so nothing
// in the library namespace can collide with it) and where the client serves it
export const FAST_KEY = 'skyfast/sky_system_fast.js';
export const FAST_URL = '/lib/skyfast/sky_system_fast.js';

// The fast copy's optimization flags, in the plan's priority order. All ON by
// default under ?sky=fast; `?skyfast=-name[,-name2]` turns one off.
export const SKYFAST_FLAGS = ['lighttop', 'erosion', 'loops', 'powder'];

/** Parse a location.search string. Returns { fast, flags, off, unknown }:
 *  fast = ?sky=fast; flags = the enabled flags (in SKYFAST_FLAGS order);
 *  off = names disabled by `-name`; unknown = anything we didn't recognise. */
export function parseSkyVariant(search = '') {
  const q = new URLSearchParams(search);
  const fast = q.get('sky') === 'fast';
  const off = new Set(), unknown = [];
  for (const raw of (q.get('skyfast') ?? '').split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const name = t.startsWith('-') ? t.slice(1) : t;
    if (!SKYFAST_FLAGS.includes(name)) { unknown.push(t); continue; }
    if (t.startsWith('-')) off.add(name);   // a bare name is the default (on): accepted, no-op
  }
  return { fast, flags: SKYFAST_FLAGS.filter((f) => !off.has(f)), off: [...off], unknown };
}

/** Point the virtual FS at the chosen sky_system before makeSky evals it.
 *  Returns the one-line label to tee ("[sky] sky_system: original" / "… fast (flags …)"). */
export async function prepareSkySystem(search, { primeBytes, aliasDenoFile, env }) {
  const v = parseSkyVariant(search);
  if (!v.fast) {
    aliasDenoFile(SKY_SYSTEM_PATH, null);
    env.SKYFAST = undefined;
    return '[sky] sky_system: original';
  }
  await primeBytes(FAST_KEY, FAST_URL);
  aliasDenoFile(SKY_SYSTEM_PATH, FAST_KEY);
  // '' (every flag disabled) is meaningful to the fast copy: all off
  env.SKYFAST = v.flags.join(',');
  const extra = [v.off.length ? `off: ${v.off.join(',')}` : '', v.unknown.length ? `unknown: ${v.unknown.join(',')}` : '']
    .filter(Boolean).join('; ');
  return `[sky] sky_system: fast (flags ${v.flags.join(',') || 'none'})${extra ? ` [${extra}]` : ''}`;
}
