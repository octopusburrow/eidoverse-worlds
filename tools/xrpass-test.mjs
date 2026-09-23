// client/lib/xrpass.js: stereo cameras are routed to their own chain map ('xr', 'xr:backSide'), exactly once even
// when three's own rebuild re-enters get() with the prefixed id; mono cameras and zero-eye array cameras are not.
// tools/xr-switch-compile-probe.mjs is the real-three half (both variants live side by side; the switch builds nothing).
import * as THREE from '../client/node_modules/three/build/three.webgpu.js';
import { separateXRPass, stereoStandIn } from '../client/lib/xrpass.js';
let pass = 0, fail = 0;
const check = (name, ok, note = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${note ? `  -- ${note}` : ''}`); } };
class FakeObjects { constructor() { this.seen = []; } get(o, m, s, cam, l, rc, cc, passId) { this.seen.push(passId); if (o === 'rebuild' && this.seen.length === 1) return this.get('again', m, s, cam, l, rc, cc, passId); return passId; } }
console.log('XR PASS SPLIT');
const objs = new FakeObjects(), r = { _objects: objs };
check('installs', separateXRPass(r) === true);
check('installs once; no renderer / no _objects → false', separateXRPass(r) === false && separateXRPass(null) === false && separateXRPass({}) === false);
const mono = new THREE.PerspectiveCamera(), empty = new THREE.ArrayCamera(), stereo = stereoStandIn(THREE, mono);
check('the stand-in has TWO eyes (xr.getCamera() has zero before a session)', stereo.isArrayCamera && stereo.cameras.length === 2 && empty.cameras.length === 0);
check('mono camera: passId untouched', objs.get(1, 1, 1, mono, 1, 1, 1, undefined) === undefined && objs.get(1, 1, 1, mono, 1, 1, 1, 'backSide') === 'backSide');
check('zero-eye ArrayCamera: untouched (it renders the mono shader)', objs.get(1, 1, 1, empty, 1, 1, 1, null) === null);
check('stereo: default pass → "xr"', objs.get(1, 1, 1, stereo, 1, 1, 1, null) === 'xr');
check('stereo: backSide → "xr:backSide"', objs.get(1, 1, 1, stereo, 1, 1, 1, 'backSide') === 'xr:backSide');
objs.seen.length = 0; objs.get('rebuild', 1, 1, stereo, 1, 1, 1, null);
check("three's re-entrant rebuild keeps ONE prefix", objs.seen.join() === 'xr,xr', objs.seen.join());
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
