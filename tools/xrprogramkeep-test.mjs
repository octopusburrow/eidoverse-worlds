// The retention LRU in client/lib/xrprogramkeep.js: released programs/pipelines stay findable up to the cap;
// past it the OLDEST is really released, but only if nothing picked it back up (usedTimes > 0 = live, skip).
// tools/xr-switch-compile-probe.mjs is the real-three half (the switch builds nothing on exit).
import { keepProgramsAcrossXR } from '../client/lib/xrprogramkeep.js';
let pass = 0, fail = 0;
const check = (name, ok, note = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${note ? `  -- ${note}` : ''}`); } };
class FakePipelines {
  constructor() { this.released = []; }
  _releaseProgram(p) { this.released.push(p.id); }
  _releasePipeline(p) { this.released.push(p.id); }
}
console.log('XR PROGRAM KEEP');
const P = new FakePipelines(), r = { _pipelines: P };
const k = keepProgramsAcrossXR(r, { cap: 3 });
check('installs, reports its cap', !!k && k.cap === 3);
check('installs once', keepProgramsAcrossXR(r) === null);
check('no renderer / no pipelines yet (before init) → null', keepProgramsAcrossXR(null) === null && keepProgramsAcrossXR({}) === null);
const o = (id, usedTimes = 0) => ({ id, usedTimes });
const a = o('a'), b = o('b'), c = o('c'), d = o('d'), e = o('e');
P._releaseProgram(a); P._releasePipeline(b); P._releaseProgram(c);
check('under the cap nothing is really released', P.released.length === 0 && k.size === 3);
P._releaseProgram(d);
check('over the cap the OLDEST really goes', P.released.join() === 'a' && k.size === 3, P.released.join());
b.usedTimes = 1;   // the next switch picked b back up
P._releaseProgram(e);
check('a live (picked-up) entry is dropped from the LRU, NOT released', P.released.join() === 'a' && k.size === 3, P.released.join());
b.usedTimes = 0; P._releasePipeline(b);
check('released again later, it re-enters at the young end', k.size === 3 && P.released.join() === 'a,c', P.released.join());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
