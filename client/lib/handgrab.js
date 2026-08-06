// handgrab — picking things up with a mouse, gated on the `grab` component.
//
// The VR hands have had this since the beginning (xr.js): grip a thing, it
// rides your hand, releasing SPEAKS A PLACE VERB so the move is a sentence in
// the log like any other. Desktop had nothing — you could only drag things in
// their edit mode, which is a different act (editing a scene) from picking a
// thing up (being in a room with objects).
//
// What makes it a room rather than an editor is the GATE: only things wearing
// the `grab` component can be lifted. That component is one button in the
// inspector, so "this is a thing people can pick up" becomes a property an
// author grants, not a mode a viewer enters. Dice and chess pieces get it; the
// floor does not.
//
// Reach is measured from the BODY, not the camera (the classic third-person
// bug is grabbing something four metres away because the camera was close).
// Selection is by cursor ray with a small screen-space tolerance, preferring
// the SMALLEST candidate — a raw ray makes a die nearly unpickable next to a
// table, because the table is easier to hit. Small-wins inverts that.

import { THREE, camera, canvas, bus, CONFIG } from './core.js';
import { entities, comps } from './world.js';
import { sendVerb } from './net.js';
import { recordPair } from './editundo.js';
import { flashHint } from './ui.js';
import { myState, isMouselook } from './controller.js';
import { isEditing } from './build.js';
import { isWorkshopOpen } from './workshop.js';

const REACH = 2.2;              // metres from the body — an arm plus a lean
const CONE_PX = 14;             // screen-space slop, so tiny things are pickable
const HOLD_DIST = 1.15;         // how far in front of the eye a held thing floats

let held = null;                // {id, prevParent, prevPlace, holder}
let holder = null;              // Object3D that carries the held thing
const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _lastNdc = new THREE.Vector2();

export const isHolding = () => !!held?.id;
export const heldId = () => held?.id ?? null;

const grabbable = (id) => !!comps.get(id)?.grab;

/** Everything grabbable whose BODY-distance is within reach. */
function inReach() {
  const out = [];
  _v.set(myState.pos.x, myState.pos.y + 1.0, myState.pos.z);
  for (const [id, obj] of entities) {
    if (!obj || !grabbable(id)) continue;
    obj.getWorldPosition(_v2);
    const d = _v.distanceTo(_v2);
    if (d <= REACH) out.push({ id, obj, d });
  }
  return out;
}

/** Cursor (or crosshair, in mouselook) ray with cone slop; smallest wins. */
function pick(ev) {
  const cands = inReach();
  if (!cands.length) return null;
  // ev is null when the frame loop asks "what would I take right now?" — then
  // the last known cursor position stands in (or the crosshair in mouselook)
  if (isMouselook()) _ndc.set(0, 0);            // locked pointer = screen centre
  else if (ev) {
    const r = canvas.getBoundingClientRect();
    _ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1,
             -((ev.clientY - r.top) / r.height) * 2 + 1);
    _lastNdc.copy(_ndc);
  } else _ndc.copy(_lastNdc);
  _ray.setFromCamera(_ndc, camera);
  // widen the ray into a cone by testing against each candidate's screen-space
  // distance from the cursor rather than demanding a literal intersection
  const slopNdc = (CONE_PX / Math.min(innerWidth, innerHeight)) * 2;
  let best = null;
  for (const c of cands) {
    c.obj.getWorldPosition(_v2);
    const screen = _v2.clone().project(camera);
    if (screen.z > 1) continue;                  // behind the camera
    const off = Math.hypot(screen.x - _ndc.x, screen.y - _ndc.y);
    if (off > slopNdc * 4) continue;             // not under the pointer at all
    // Proximity DOMINATES; size only breaks near-ties. The first version
    // scored `off*2 + size`, which let a die anywhere in the cone beat a
    // table directly under the cursor — small-wins so strong it stopped
    // being a tiebreak and became the whole rule. Normalizing the offset
    // against the cone keeps "what you are pointing at" primary, with a
    // bounded size nudge so a die on a table still wins when both are
    // genuinely under the pointer.
    const box = new THREE.Box3().setFromObject(c.obj);
    const size = box.getSize(_v).length();
    const nearness = off / (slopNdc * 4);        // 0 at the cursor, 1 at cone edge
    const bulk = Math.min(1, size / 2);          // bounded: a huge thing is just 1
    const score = nearness + bulk * 0.35;
    if (!best || score < best.score) best = { ...c, score };
  }
  return best?.id ?? null;
}

function take(id) {
  const obj = entities.get(id);
  if (!obj) return;
  holder ??= new THREE.Object3D();
  if (!holder.parent) camera.add(holder);
  holder.position.set(0, -0.15, -HOLD_DIST);
  held = {
    id,
    prevParent: obj.parent,
    prevPlace: {
      id,
      pos: [+obj.position.x.toFixed(3), +obj.position.y.toFixed(3), +obj.position.z.toFixed(3)],
      rot: [+obj.rotation.x.toFixed(4), +obj.rotation.y.toFixed(4), +obj.rotation.z.toFixed(4)],
      scale: obj.scale.toArray().map((n) => +n.toFixed(3)),
    },
  };
  holder.attach(obj);            // preserves world transform; it rides the view
  bus.emit('grab', { id, holding: true });
  flashHint(`holding ${id} — click to set it down`);
}

function drop() {
  if (!held) return;
  const obj = entities.get(held.id);
  const { prevParent, prevPlace } = held;
  if (obj) {
    prevParent.attach(obj);      // back into the world, where it visually is
    const args = {
      id: held.id,
      pos: [+obj.position.x.toFixed(3), +obj.position.y.toFixed(3), +obj.position.z.toFixed(3)],
      rot: [+obj.rotation.x.toFixed(4), +obj.rotation.y.toFixed(4), +obj.rotation.z.toFixed(4)],
    };
    // the move becomes a sentence, so undo can unsay it — same contract as
    // the VR hands, and the same one an agent speaking `place` would use
    recordPair({ verb: 'place', args: prevPlace }, { verb: 'place', args });
    sendVerb('place', args);
  }
  bus.emit('grab', { id: held.id, holding: false });
  held = null;
}

// ---- the affordance -------------------------------------------------------
// You could pick things up but nothing said which things — the gate was
// invisible, so using it was guesswork. Grabbable things within reach get a
// faint rim of warmth, brightest for the one you would actually take.
//
// Deliberately NOT the `notice` component's job: notice is comp-driven, an
// author opting a specific thing into warming under gaze. This is automatic
// and structural — it reports a CAPABILITY of the world (this can be lifted),
// not an authored behaviour. Same visual grammar, different claim, so it is a
// separate small system rather than a hijack of that one.
const _lit = new Map();          // material -> original emissive hex
const _warm = new THREE.Color('#8fe8c8');

function litFor(id, amount) {
  const obj = entities.get(id);
  if (!obj) return;
  obj.traverse((o) => {
    if (!o.material || !('emissive' in o.material)) return;
    // own material first — shared GLB-cache materials made a hover warm every
    // sibling of the same model (same leak as notice.js, fixed 08-06)
    if (!o.userData.ownMat) { o.material = o.material.clone(); o.userData.ownMat = true; }
    const m = o.material;
    if (!_lit.has(m)) _lit.set(m, m.emissive.getHex());
    m.emissive.setHex(_lit.get(m)).lerp(_warm, amount);
  });
}

function coolAll(except) {
  for (const [m, hex] of _lit) {
    if (except?.has(m)) continue;
    m.emissive.setHex(hex);
    _lit.delete(m);
  }
}

/** Per-frame: warm what's takeable, brightest on the current candidate. */
export function updateGrabHints() {
  if (held || isEditing() || isWorkshopOpen()) { coolAll(); return; }
  const cands = inReach();
  if (!cands.length) { coolAll(); return; }
  // At frame time there may be no cursor event and no prior one (a fresh tab,
  // or mouselook). Rather than reuse pick()'s cursor path — which silently
  // scored against a stale NDC — score the candidates directly against the
  // screen centre, which is what "what would I take right now" means when
  // nobody has moved a mouse yet.
  let top = null, bestScore = Infinity;
  for (const c of cands) {
    c.obj.getWorldPosition(_v2);
    const screen = _v2.clone().project(camera);
    if (screen.z > 1) continue;                    // behind the eye
    const off = Math.hypot(screen.x - _lastNdc.x, screen.y - _lastNdc.y);
    if (off > 0.55) continue;                      // not anywhere near the aim
    const box = new THREE.Box3().setFromObject(c.obj);
    const score = off / 0.55 + Math.min(1, box.getSize(_v).length() / 2) * 0.35;
    if (score < bestScore) { bestScore = score; top = c.id; }
  }
  const keep = new Set();
  for (const c of cands) {
    litFor(c.id, c.id === top ? 0.5 : 0.16);
    c.obj.traverse((o) => { if (o.material && 'emissive' in o.material) keep.add(o.material); });
  }
  coolAll(keep);
}

export function initHandGrab() {
  canvas.addEventListener('click', (ev) => {
    if (CONFIG.spectate) return;
    // Editors own the click while they're open: in an edit surface a click
    // means SELECT THIS, and a grab that fired underneath it would fight the
    // selection. Picking things up is what you do when you're not editing —
    // being in the room, rather than working on it. (Both editors already
    // bind canvas clicks; three handlers on one event needs a clear order.)
    if (isEditing() || isWorkshopOpen()) return;
    if (held) { drop(); return; }
    const id = pick(ev);
    if (id) take(id);
  });
  // dropping is also what Escape means while holding something
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && held) drop();
  });
  // never keep hold of a thing that left the world under you
  bus.on('entity', ({ id, kind }) => {
    if (held?.id === id && kind === 'remove') { held = null; }
  });
}
