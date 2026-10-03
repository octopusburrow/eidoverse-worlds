// shared/unstuck.js against the REAL resolveColliders (client/lib/colliders.js) — exact meshes, generic boxes,
// structure floors, pillars — headless through tools/core-stub.mjs, the way tools/collider-test.ts runs it.
// The fake-resolver test (unstuck-test.mjs) models only generic boxes; the bug R hit was most likely an EXACT
// mesh (room-scale meshes auto-select it), whose floor ray answers with a thick roof's underside. Harness pattern
// and the failing cases come from the review of f4bf844.
//   BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/unstuck-real-test.ts
import { plugin } from 'bun';
const STUB = new URL('./core-stub.mjs', import.meta.url).pathname;
plugin({ name: 'core-stub', setup(b) { b.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: STUB })); } });
const { THREE } = await import(STUB);
const { mergeGeometries } = await import('../client/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
const C: any = await import('../client/lib/colliders.js');
const { findFreeSpot } = await import('../shared/unstuck.js');

const v = new THREE.Vector3(), o = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const probe = (x: number, y: number, z: number) => { v.set(x, y, z); const g = C.resolveColliders(v, () => 0); return { x: v.x, z: v.z, ground: g }; };
// the same headroom the client passes (controller.js)
const headroom = (x: number, y: number, z: number) => { o.set(x, y + 0.05, z); return C.raySegment(o, up, 1.85) === null; };
const S = { headroom };
const clear = () => { for (const id of [...C.colliders.keys()]) C.removeCollider(id); };
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
function fit(id: string, geoms: any[], collide?: string) {
  const m = new THREE.Mesh(mergeGeometries(geoms, false), undefined); m.updateMatrixWorld(true);
  C.fitCollider(id, m, { collide }); m.updateMatrixWorld(true); C.reindexCollider(id); return C.colliders.get(id);
}
const temple = (thick: number) => [
  box(9, 0.2, 9, 0, -0.1, 0),
  box(0.5, 3, 9, -4.25, 1.5, 0), box(0.5, 3, 9, 4.25, 1.5, 0), box(9, 3, 0.5, 0, 1.5, -4.25), box(9, 3, 0.5, 0, 1.5, 4.25),
  box(9, thick, 9, 0, 3 + thick / 2, 0),
];
// after a move, the NEXT frame's walk resolve must agree you are standing there (not inside the roof)
const walkGround = (s: any) => probe(s.x, s.y, s.z).ground;

let fail = 0;
const ok = (name: string, cond: boolean, got?: any) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, cond ? '' : JSON.stringify(got)); if (!cond) fail++; };

for (const thick of [0.3, 0.6, 1.2]) {
  clear(); const e = fit('temple', temple(thick), 'exact');
  const s = findFreeSpot(probe, { x: 1, y: 0, z: 1 }, S);
  ok(`exact temple, roof 3..${3 + thick}: /unstuck from the floor lands on the TOP (not the underside)`,
    !!e.exact && s?.how === 'on-top' && Math.abs(s.y - (3 + thick)) < 0.02 && Math.abs(walkGround(s) - s.y) < 0.02, { exact: !!e.exact, s, walk: s && walkGround(s) });
}

const hall = (top: number) => [box(13, 0.2, 13, 0, -0.1, 0),
  box(0.5, top, 13, -6.25, top / 2, 0), box(0.5, top, 13, 6.25, top / 2, 0), box(13, top, 0.5, 0, top / 2, -6.25), box(13, top, 0.5, 0, top / 2, 6.25),
  box(13, 0.6, 13, 0, top + 0.3, 0)];
for (const h of [6.5, 8]) {
  clear(); fit('hall', hall(h), 'exact');
  const s = findFreeSpot(probe, { x: 1, y: 0, z: 1 }, S);
  ok(`a tall exact hall, roof ${h}..${h + 0.6}: /unstuck still finds the top (re-review: 6 m scan said "not stuck")`, s?.how === 'on-top' && Math.abs(s.y - (h + 0.6)) < 0.02, s);
}
clear(); fit('temple', temple(0.3), 'exact');
let s = findFreeSpot(probe, { x: 1, y: 3.3, z: 1 }, S);
ok('standing on an exact roof → left alone', s?.how === 'free' && Math.abs(s.y - 3.3) < 1e-6, s);

// KNOWN LIMIT (not asserted): deep inside a big solid exact mesh no face is within the shove radius or the 1.85 m
// headroom ray, so the search can't tell inside from outside. The fallback is /respawn. Printed so a change shows.
clear(); fit('rock', [box(10, 10, 10, 0, 5, 0)], 'exact');
console.log('KNOWN LIMIT inside a solid 10 m exact block →', JSON.stringify(findFreeSpot(probe, { x: 0, y: 2, z: 0 }, S)));

clear(); C.fitStructureBoxes('house', [{ x0: -4, y0: 3, z0: -4, x1: 4, y1: 3.4, z1: 4, kind: 'floor' }], { position: [0, 0, 0] });
s = findFreeSpot(probe, { x: 1, y: 0, z: 1 }, S);
ok('a structure floor overhead → on top of it', s?.how === 'on-top' && Math.abs(s.y - 3.4) < 1e-6, s);
C.removeStructureBoxes('house');

// /respawn's search (onTop: false): never onto what stands over the world's start
clear(); fit('tree', [box(2, 4, 2, 0, 2, 0)]);
s = findFreeSpot(probe, { x: 0, y: 0, z: 0 }, { ...S, onTop: false });
// a tall thing collides as a 0.5 m centre post (colliders.js: the pillar rule), not its canopy box
ok('respawn under a 4 m tree → beside its trunk on the ground, not on top, and the walk resolve agrees',
  !!s && s.y < 0.01 && Math.hypot(s.x, s.z) > 0.25 + 0.32 && (() => { const p = probe(s.x, s.y, s.z); return Math.hypot(p.x - s.x, p.z - s.z) < 1e-3; })(), s);

clear(); C.fitStructureBoxes('gz', [
  { x0: -2, y0: 0, z0: -2, x1: -1.8, y1: 2.6, z1: -1.8 }, { x0: 1.8, y0: 0, z0: -2, x1: 2, y1: 2.6, z1: -1.8 },
  { x0: -2, y0: 0, z0: 1.8, x1: -1.8, y1: 2.6, z1: 2 }, { x0: 1.8, y0: 0, z0: 1.8, x1: 2, y1: 2.6, z1: 2 },
  { x0: -2, y0: 2.6, z0: -2, x1: 2, y1: 2.8, z1: 2 }], { position: [0, 0, 0] });
s = findFreeSpot(probe, { x: 0, y: 0, z: 0 }, { ...S, onTop: false });
ok('respawn under an open gazebo → at the origin under it, not on its roof', s?.how === 'free' && s.y < 0.01 && Math.hypot(s.x, s.z) < 1e-6, s);
C.removeStructureBoxes('gz');

console.log(fail ? `${fail} FAILED` : 'all pass');
process.exit(fail ? 1 : 0);
