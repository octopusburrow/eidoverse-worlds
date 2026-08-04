// notice — things that notice you looking. (Rilke, Dinggedichte: "the house
// had a face of its own and it reached out to me." — Hillesum, Easter 1942.)
//
// comp {id, type:'notice', data:{color?, rise?}} marks an entity as one that
// warms under attention: when a viewer's gaze rests on it, its materials'
// emissive lifts toward `color` over `rise` seconds, and cools again when the
// gaze moves on. PRESENTATIONAL AND PER-VIEWER by design — the same class of
// client-local effect as a hover highlight or selection tint. Nothing about
// the warming is logged; what IS logged (the comp) is the fact that this
// thing is the kind of thing that notices.
//
// GAZE = THE BODY'S FACING, not the camera. In third-person orbit the screen
// center is your own avatar (probe7: the crosshair lands on char1001), so a
// camera-ray "gaze" would mean staring at yourself forever. The body's eye
// and yaw are the one attention-source every participant has — mouselook
// mirrors them, XR drives them from the head, and an AGENT has exactly
// pos+yaw and nothing else. One rule, every kind of looker. (Agent parity
// by construction: the data is the capability; the glow is one renderer's
// account of it.)
//
// Determinism note: per the component doctrine this holds parameters, never
// code, and no component data is written per-frame. Heat lives client-side.

import { THREE, bus } from './core.js';
import { entities } from './world.js';
import { registerComponent } from './components.js';
import { myState } from './controller.js';

const noticed = new Map();   // id -> {color: THREE.Color, rise: s, heat: 0..1}
const touched = new Map();   // material -> original emissive hex (for restore)

bus.on('comp', ({ id, type, data }) => {
  if (type !== 'notice') return;
  if (data == null) { cool(id, true); noticed.delete(id); return; }
  noticed.set(id, {
    color: new THREE.Color(data.color ?? '#ffb060'),
    rise: Math.max(0.05, Number(data.rise) || 0.8),
    heat: noticed.get(id)?.heat ?? 0,
  });
});

const _ray = new THREE.Raycaster();
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let _tick = 0, _lastNow = 0;

function applyHeat(id, n) {
  const obj = entities.get(id);
  if (!obj) return;
  obj.traverse((o) => {
    if (!o.isMesh || !o.material || !('emissive' in o.material)) return;
    if (!touched.has(o.material)) touched.set(o.material, o.material.emissive.getHex());
    const base = touched.get(o.material);
    o.material.emissive.setHex(base).lerp(n.color, n.heat * 0.85);
  });
}

function cool(id, hard = false) {
  const obj = entities.get(id);
  if (!obj) return;
  obj.traverse((o) => {
    if (o.isMesh && o.material && touched.has(o.material) && hard) {
      o.material.emissive.setHex(touched.get(o.material));
    }
  });
}

/** Called from the frame loop. Raycasts at ~12Hz; heat eases every frame. */
export function updateNotice(now) {
  if (!noticed.size) return;
  const dt = Math.min(0.1, (now - _lastNow) / 1000 || 0.016);
  _lastNow = now;

  let hitId = null;
  if (++_tick % 5 === 0) {                       // ray at ~12Hz is plenty
    const roots = [];
    for (const id of noticed.keys()) { const o = entities.get(id); if (o) roots.push(o); }
    if (roots.length) {
      _eye.copy(myState.pos).y += 1.6;            // the body's eye — pos is the FEET (gravity settles it to ground)
      _fwd.set(Math.sin(myState.yaw), 0, Math.cos(myState.yaw));
      _ray.set(_eye, _fwd);
      _ray.far = 40;                              // attention has a range
      const hit = _ray.intersectObjects(roots, true)[0];
      let p = hit?.object;
      while (p && !p.userData.entityId) p = p.parent;
      _lastHit = p && noticed.has(p.userData.entityId) ? p.userData.entityId : null;
    } else _lastHit = null;
  }
  hitId = _lastHit;

  for (const [id, n] of noticed) {
    const target = id === hitId ? 1 : 0;
    const rate = dt / (target ? n.rise : n.rise * 1.6);   // cooling is slower — things remember being seen
    const next = n.heat + Math.sign(target - n.heat) * Math.min(rate, Math.abs(target - n.heat));
    if (Math.abs(next - n.heat) > 1e-4) { n.heat = next; applyHeat(id, n); }
  }
}
let _lastHit = null;

registerComponent('notice', {
  hint: 'warms under your gaze (Dinggedichte)',
  defaults: { color: '#ffb060', rise: 0.8 },
});

/** debug window into the attention state (harness use) */
export const noticeDebug = () => ({ noticed: [...noticed.entries()].map(([id, n]) => [id, +n.heat.toFixed(3)]), lastHit: _lastHit });
