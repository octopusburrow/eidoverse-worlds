// transform — full 3-axis rotation + non-uniform scale, as a component.
//
// The place verb speaks pos + yaw + ONE uniform scale, and that stays true:
// place owns the entity ROOT. This component owns an inner wrapper group
// ('__xf') between the root and the model, so the two never fight — logged
// place = where it stands and how big; transform comp = how it TUMBLES and
// STRETCHES. (And picture owns the mesh below both: three layers, composing.)
// Rotation is euler XYZ in RADIANS in the log (the log always speaks
// radians); the inspector editor speaks DEGREES (humans think in degrees —
// same convention as the channel box yaw°).
//
// Once this proves out in-world it becomes the evidence brief for a place-
// verb orientation extension upstream — R's ruling 08-03: "yaw-only has got
// to change."
//
// v1 caveat, on purpose: socket resolution (sit/mount math) reads the root
// frame, so a heavily transformed entity's seats will visually drift from
// their math. Noted in the design doc; fix rides with a socket-frame slice.

import { THREE, bus } from './core.js';
import { entities } from './world.js';
import { registerComponent } from './components.js';

const wanted = new Map();    // id -> {rot:[x,y,z] rad, scale:[x,y,z]}

function apply(id) {
  const data = wanted.get(id);
  const root = entities.get(id);
  if (!root) return;
  let g = root.getObjectByName('__xf');
  if (!data) {                                    // comp removed → identity
    if (g) { g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1); }
    return;
  }
  if (!g) {
    g = new THREE.Group();
    g.name = '__xf';
    root.add(g);
  }
  // adopt any model children that arrived on the root (GLBs load async and
  // can land after the comp folds — re-adopt on every apply)
  for (const c of [...root.children]) if (c !== g) g.add(c);
  const [rx, ry, rz] = data.rot ?? [0, 0, 0];
  const [sx, sy, sz] = data.scale ?? [1, 1, 1];
  g.rotation.set(Number(rx) || 0, Number(ry) || 0, Number(rz) || 0);
  g.scale.set(Number(sx) || 1, Number(sy) || 1, Number(sz) || 1);
}

bus.on('comp', ({ id, type, data }) => {
  if (type !== 'transform') return;
  if (data == null) { wanted.delete(id); apply(id); return; }
  wanted.set(id, data);
  apply(id);
});
bus.on('entity', ({ id } = {}) => {              // late-loading models get adopted
  if (id && wanted.has(id)) apply(id);
  else if (!id) for (const k of wanted.keys()) apply(k);
});

// ---- registry: degrees at the surface, radians in the log -----------------
const DEG = 180 / Math.PI;
const IN = 'width:100%;box-sizing:border-box;background:rgba(4,14,20,.9);color:var(--fg);border:1px solid var(--edge);border-radius:4px;padding:2px 6px;font:11px inherit';
const numIn = (v, step) => `<input type="number" step="${step}" value="${+v.toFixed(2)}" style="${IN}">`;

registerComponent('transform', {
  hint: '3-axis rotation + non-uniform scale (place keeps pos/yaw/size)',
  defaults: { rot: [0, 0, 0], scale: [1, 1, 1] },
  editor: (id, data) => {
    const r = data?.rot ?? [0, 0, 0], s = data?.scale ?? [1, 1, 1];
    const row = (lab, v, step) => `<span>${lab}</span>${numIn(v, step)}`;
    return `<div data-xf style="display:grid;grid-template-columns:52px minmax(0,1fr);gap:3px 6px;align-items:center;font-size:11px">
      ${row('rot X°', r[0] * DEG, 5)}${row('rot Y°', r[1] * DEG, 5)}${row('rot Z°', r[2] * DEG, 5)}
      ${row('scl X', s[0], 0.05)}${row('scl Y', s[1], 0.05)}${row('scl Z', s[2], 0.05)}
    </div>`;
  },
  wire: (root, id, commit) => {
    const ins = [...root.querySelectorAll('input')];
    const push = () => commit({
      rot: [(+ins[0].value || 0) / DEG, (+ins[1].value || 0) / DEG, (+ins[2].value || 0) / DEG],
      scale: [+ins[3].value || 1, +ins[4].value || 1, +ins[5].value || 1],
    });
    for (const el of ins) el.addEventListener('change', push);
  },
});
