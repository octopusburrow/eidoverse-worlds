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

import { THREE, bus, camera } from './core.js';
import { entities } from './world.js';
import { registerComponent } from './components.js';
import { myState, mouse } from './controller.js';
import { glowSet, glowRemove } from './glow.js';

const noticed = new Map();   // id -> {color: THREE.Color, rise: s, heat: 0..1}

bus.on('comp', ({ id, type, data }) => {
  if (type !== 'notice') return;
  if (data == null) { cool(id); noticed.delete(id); return; }
  noticed.set(id, {
    color: new THREE.Color(data.color ?? '#ffb060'),
    rise: Math.max(0.05, Number(data.rise) || 0.8),
    heat: noticed.get(id)?.heat ?? 0,
  });
});

const _ray = new THREE.Raycaster();
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let _lastNow = 0, _lastRay = -1e9;

// INSTANCE-SAFE WARMTH (R, 08-06, second pass): the first fix cloned the
// shared material, which un-instanced the asset — "why do you hate
// instancing" is a fair charge with a memory file behind it. The warmth now
// never touches the asset: glow.js attaches a transient additive shell
// (geometry by reference) while heat > 0 and removes it after. The material
// every sibling shares is never written.
function applyHeat(id, n) {
  glowSet(id, entities.get(id), n.color, n.heat);
}

function cool(id) {
  glowRemove(id);
}

/** Called from the frame loop. Raycasts at ~12Hz; heat eases every frame. */
export function updateNotice(now) {
  if (!noticed.size) return;
  const dt = Math.min(0.1, (now - _lastNow) / 1000 || 0.016);
  _lastNow = now;

  let hitId = null;
  if (now - _lastRay > 120) {                    // ray at ~8Hz WALL TIME — frame-count
    _lastRay = now;                              // cadence starves at low fps (suite/VR)
    const roots = [];
    for (const id of noticed.keys()) { const o = entities.get(id); if (o) roots.push(o); }
    if (roots.length) {
      // GAZE = THE CURSOR RAY (R, 08-06: body-facing "is not how any gaming
      // surface works" — and she's right; the earlier agent-parity argument
      // conflated sensing with rendering. Agents act by NAME through verbs
      // (`place {id}` — AGENTS.md) and never needed aim; this glow is
      // per-viewer presentation, so it follows the human pointer convention
      // every other surface here already uses, handgrab included). In
      // mouselook the cursor pins to (0,0) = crosshair; in cursor mode it's
      // wherever you point. Range still gates it: attention from across the
      // map is not attention.
      _ray.setFromCamera(mouse, camera);
      _ray.far = 40;
      _eye.copy(myState.pos).y += 1.6;
      const hit = _ray.intersectObjects(roots, true)[0];
      let p = hit?.object;
      while (p && !p.userData.entityId) p = p.parent;
      const nearEnough = hit && hit.point.distanceTo(_eye) < 24;   // measured from the body, like reach
      _lastHit = nearEnough && p && noticed.has(p.userData.entityId) ? p.userData.entityId : null;
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
