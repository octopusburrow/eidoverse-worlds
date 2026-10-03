// shared/unstuck.js against a fake resolver with resolveColliders' contract: a box is FLOOR when
// the body is within 8cm of its top (or above it, within a step), a WALL (shove x/z out) when the
// body's span overlaps it, terrain is 0. Run: bun tools/unstuck-test.mjs
import { findFreeSpot, isFree } from '../shared/unstuck.js';

const STEP = 0.55, TALL = 1.9, R = 0.32;
function makeProbe(boxes) {
  return (x, y, z) => {
    let ground = 0, px = x, pz = z;
    for (const b of boxes) {
      const inXZ = px > b.x0 - R && px < b.x1 + R && pz > b.z0 - R && pz < b.z1 + R;
      const strictXZ = px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1;
      if (!inXZ) continue;
      if (y >= b.top - 0.08) { if (strictXZ && b.top <= y + STEP && b.top > ground) ground = b.top; continue; }
      if (y + TALL > b.bottom) {   // the body overlaps the box: shove out the nearest side
        const d = [[px - (b.x0 - R), 'x', b.x0 - R], [(b.x1 + R) - px, 'x', b.x1 + R],
                   [pz - (b.z0 - R), 'z', b.z0 - R], [(b.z1 + R) - pz, 'z', b.z1 + R]].sort((a, c) => a[0] - c[0])[0];
        if (d[1] === 'x') px = d[2]; else pz = d[2];
      }
    }
    return { x: px, z: pz, ground };
  };
}

let fail = 0;
const ok = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, cond ? '' : JSON.stringify(got)); if (!cond) fail++; };

const roof = { x0: -5, x1: 5, z0: -5, z1: 5, bottom: 4, top: 5 };
const p1 = makeProbe([roof]);

let s = findFreeSpot(p1, { x: 1, y: 4.3, z: 1 });
ok('sunk into the roof → on top of it', s?.how === 'on-top' && Math.abs(s.y - 5) < 1e-9 && s.x === 1, s);

s = findFreeSpot(p1, { x: 1, y: 5, z: 1 });
ok('standing on the roof → left alone', s?.how === 'free' && s.y === 5, s);

const underRoof = { x0: -5, x1: 5, z0: -5, z1: 5, bottom: 2.2, top: 2.5 };
s = findFreeSpot(makeProbe([underRoof]), { x: 0, y: 0, z: 0 });
ok('fallen through into the space under a roof (free, but enclosed — R\'s case) → up onto the roof',
  s?.how === 'on-top' && Math.abs(s.y - 2.5) < 1e-9, s);

const roomRoof = { x0: -5, x1: 5, z0: -5, z1: 5, bottom: 3.0, top: 3.3 };
s = findFreeSpot(makeProbe([roomRoof]), { x: 0, y: 0, z: 0 });
ok('a roof whose slab starts exactly at the probe height (the browser probe\'s room, 3.0..3.3) → up onto it',
  s?.how === 'on-top' && Math.abs(s.y - 3.3) < 1e-9, s);

const twoStorey = [{ x0: -5, x1: 5, z0: -5, z1: 5, bottom: 2.6, top: 2.8 }, { x0: -5, x1: 5, z0: -5, z1: 5, bottom: 5.4, top: 5.6 }];
s = findFreeSpot(makeProbe(twoStorey), { x: 0, y: 0, z: 0 });
ok('two storeys above → the NEAREST roof, not the top one', s?.how === 'on-top' && Math.abs(s.y - 2.8) < 1e-9, s);

s = findFreeSpot(makeProbe([]), { x: 3, y: 0, z: 3 });
ok('free under open sky → left alone', s?.how === 'free' && s.x === 3 && s.y === 0, s);

const crate = { x0: -1, x1: 1, z0: -1, z1: 1, bottom: 0, top: 0.4 };
s = findFreeSpot(makeProbe([crate]), { x: 0, y: 0.4, z: 0 });
ok('standing on a low crate (its top is my floor, not something above me) → left alone', s?.how === 'free', s);

const pillar = { x0: -1, x1: 1, z0: -1, z1: 1, bottom: 0, top: 20 };
s = findFreeSpot(makeProbe([pillar]), { x: 0.2, y: 0, z: 0 });
ok('inside a tall pillar → nearest free spot beside it, on the ground',
  s?.how === 'nearby' && s.y === 0 && isFree(makeProbe([pillar]), s) && Math.hypot(s.x, s.z) <= 2.5, s);

const vault = { x0: -50, x1: 50, z0: -50, z1: 50, bottom: -1, top: 40 };
s = findFreeSpot(makeProbe([vault]), { x: 0, y: 0, z: 0 });
ok('sealed inside solid → null (caller respawns)', s === null, s);

console.log(fail ? `${fail} FAILED` : 'all pass');
process.exit(fail ? 1 : 0);
