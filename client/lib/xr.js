// xr — the door into the headset, and everything your hands do inside it.
//
// Boot split unchanged (?xr=1 → WebGL2). This module owns: the session + rig,
// STICK LOCOMOTION (which is not locomotion at all — it fills xrIntent and the
// eidoverse controller's own wish/gravity/mantle/seat code does every bit of
// the moving; a thumbstick is a keyboard that reports fractions), the POINTER
// (right-hand ray: trigger = select, feeding the same sgSelect the hierarchy
// and viewport clicks feed), GRAB (the HIGGS chord: grip alone aims, grip+
// trigger takes — local while held, and release SPEAKS A PLACE VERB, so a VR
// grab and a typed /place are the same sentence; undo already knows how to
// unsay it), and the RADIAL MENU (right-stick PRESS opens, stick aims, release
// commits; snap turn keeps stick-X when the ring is closed; every slot is a
// verb-backed action — nothing exists only as a VR gesture. Agent parity).
//
// Knowledge ported from exultation input/xr.ts + porch-old, not the structure:
// deadzone-with-rescale, snap cooldown, tracking-loss = keep-last-pose,
// 'layers' dropped from optionalFeatures (MSAA via classic XRWebGLLayer),
// foveation 0, local-floor, and the settled law: NEVER navigate mid-session.

import { THREE, renderer, camera, scene, XR_BOOT } from './core.js';
import { CONFIG, report, bus, tee } from './base.js';
import { xrBodyDebug } from './xrbody.js';
import { stroke, fillPath } from './icons.js';
import { xrPanelsEnter, xrPanelsExit, xrPanelsPick, showXRPanel, xrPanelHas, xrPanelOpen, xrPanelsGrab, xrPanelRelease, xrPanelsShown } from './xrpanels.js';
import { myState, xrIntent, camYaw, setCamYaw, setXrProbe } from './controller.js';
import { entities } from './world.js';
import { sendVerb } from './net.js';
import { flashHint, toast } from './ui.js';
import { registerXrGlyph, glyphPinned, micGlyph, earGlyph, xrGlyph, micLive, earOn, flipEar } from './mictoggle.js';
import { dockPins } from './ui.js';
import { pushUndo } from './build.js';
import { perf } from './perf.js';
import { renderCensusTake, renderCensusTick, renderCensusPeek, setXRCurtain } from './render.js';
import { warm, P_AMBIENT } from './warmqueue.js';

// ---- self-body in first person ---------------------------------------------
// R's first headset session (23:22): own body invisible (she stood INSIDE it,
// camera at head height), own nameplate photobombing from above her own head.
// porch-old's settled answer: hide the HEAD, keep the body (looking down and
// seeing your own torso is the embodiment), hide your own label. Generic form
// for arbitrary VRMs: three-vrm firstPerson layers — setup() splits/annotates
// meshes onto FP-only (9) and TP-only (10) layers; eye cameras see 9 not 10,
// the desktop camera sees 10 not 9. main.js binds the self-avatar getter.
let getSelf = () => null;
export const bindXRSelf = (fn) => { getSelf = fn; };
const FP_LAYER = 9, TP_LAYER = 10;
let fpVrm = null;   // which vrm the head-chop is applied to — re-applied after an avatar swap
// HEAD CHOP, Basis's way (BasisLocalAvatarDriver.ScaleHeadToZero: Mapping.head.localScale = 0;
// porch-old did the same). ONE mechanism for every avatar: the RAW head bone is scaled to ~0 while
// presenting, so everything skinned to the head and its children collapses to a point behind the
// eyes, and the rest of the body draws through the ordinary path. Replaces the three-vrm layer split
// (09-04 → 09-06): that made a second skinned mesh per body part on layer 9 at enter-VR time, and R's
// own body was invisible in the headset all morning with every layer number reading correct
// (09-06 11:31–11:53) — a mechanism that can disagree with the camera is one mechanism too many.
// three-vrm's normalized rig copies ROTATIONS raw←normalized in humanoid.update(); raw scale is ours.
const HEAD_CHOP = 0.0001;
let choppedHead = null;   // { bone, scale: Vector3 }
function selfFirstPerson(on) {
  const av = getSelf();
  if (!av?.vrm) return;
  const raw = av.vrm.humanoid?.getRawBoneNode?.('head');
  if (on && raw && (fpVrm !== av.vrm || choppedHead?.bone !== raw)) {
    if (choppedHead) choppedHead.bone.scale.copy(choppedHead.scale);   // a swap: restore the old body's head first
    choppedHead = { bone: raw, scale: raw.scale.clone() };
    raw.scale.setScalar(HEAD_CHOP);
    fpVrm = av.vrm;
    tee(`[xr] head chop on (${raw.name}, Basis ScaleHeadToZero)`);
  }
  if (!on && choppedHead) { choppedHead.bone.scale.copy(choppedHead.scale); choppedHead = null; fpVrm = null; tee('[xr] head chop off'); }
  // MToon OUTLINES are a second, back-face, black hull per mesh whose width (screen mode) comes from the
  // render resolution; in the eye buffers that hull can swallow the body (R 09-06 12:08: 'the claudesona
  // is pitch black' — and probably 11:31's 'no avatar' against a near-black construct). Off on MY body
  // while presenting; remotes keep theirs until this is proven. Restored on exit.
  // outline materials live INSIDE multi-material arrays on this body (12:43 census: 5 of them) — hide the
  // MATERIAL (material.visible gates its geometry group), not the mesh. 12:33's '0 hulls' read the array.
  // (An outline-hull hide lived here 12:44–13:20: with it on, selfDrawn fell 10 → 5 and the body stayed
  // black — those 'isOutline' materials carry real geometry groups on this body. Retired; not the cause.)
  if (av.label) av.label.visible = !on; // your own name is for OTHER eyes
}
// how many of MY meshes the renderer actually drew this frame (all eyes) — 'invisible' becomes a number
let selfDrawn = 0, selfDrawnLast = 0, drawHookVrm = null;
function hookSelfDraws() {
  const av = getSelf(); const vrm = av?.vrm; if (!vrm || drawHookVrm === vrm) return;
  vrm.scene.traverse((o) => { if (o.isMesh) { const prev = o.onAfterRender; o.onAfterRender = function (...a) { selfDrawn++; prev?.apply(this, a); }; } });
  drawHookVrm = vrm;
}

const lastGood = new THREE.Vector3();
const rig = new THREE.Group();
export const xrRig = () => rig;   // xrbody.js scales tracked targets about it
export const xrHands = () => hands;   // { left, right }: { grip, ray, … } — xrbody.js reads grip world poses for arm IK
// finger curl surrogate (Tier A4; porch-old :10933): trigger value → index, grip value → the other three
const fingerCurl = { left: { index: 0, grip: 0 }, right: { index: 0, grip: 0 } };
export const xrFingerCurl = () => fingerCurl;
function sampleFingerCurl() {
  for (const hand of ['left', 'right']) {
    const gp = sourceFor(hand)?.gamepad; const b = gp?.buttons;
    if (!b) continue;
    fingerCurl[hand].index = b[0]?.value ?? (b[0]?.pressed ? 1 : 0);
    fingerCurl[hand].grip = b[1]?.value ?? (b[1]?.pressed ? 1 : 0);
  }
}
rig.name = 'xr-rig';
let presenting = false; let shadowsWere = false;
let floorSpace = null;              // 'local-floor' | 'bounded-floor' | null (fell back to 'local')
export const xrFloorSpace = () => floorSpace;

// ---- DeviceScale (Tier A5; Basis BasisHeightDriver — the AVATAR is scaled to the player)
// Map the human's standing eye height onto the avatar's: median of the first
// 120 in-session HMD heights (> 0.5 m — a seated start or tracking garbage
// must not scale), k = avatarEyeY / median, clamped .6–1.6. Provenance says why
// you are this size; saved per avatar (Basis: Fallback/Measured/Saved).
// HOW it is applied changed 09-06 12:10 (R: 'hands 8 inches from my controllers'): porch-old and
// the first port scaled the TRACKED TARGETS toward the rig by k and left the puppet at its authored
// size — so a controller 1.3 m from the rig landed 0.15 × 1.3 ≈ 20 cm short at k = 0.85, by
// construction. Basis scales the PUPPET (BasisHeightDriver.ApplyAvatarScale: the avatar root, its
// T-pose offsets, the capsule) and never the tracking. So: vrm.scene.scale = 1/k while presenting,
// targets stay 1:1, hands sit ON the controllers. xrbody reads puppetScale(); xrScale().k stays the
// measured ratio for anyone who wants the number. Restored to 1 on session end.
const SCALE_LS = 'ew-xr-scale';
const scaleState = { k: 1, source: 'fallback', samples: [], eyeY: null, locked: false, firstAt: 0 };
export const xrScale = () => ({ ...scaleState, samples: scaleState.samples.length });
/** The multiplier the self puppet wears while presenting (Basis: avatar scaled to the player). 1 when unmeasured. */
export const puppetScale = () => (presenting && scaleState.k > 0 ? 1 / scaleState.k : 1);
// harness hook (?xrsim only): feed HMD heights without waiting on a slow headless frame rate
export const xrSimSample = (y) => { if (CONFIG.params.has('xrsim')) sampleDeviceScale(y); };
function avatarEyeY() {
  const av = getSelf(); const h = av?.vrm?.humanoid;
  if (!h) return null;
  const root = av.vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const ps = av.vrm.scene.scale.y || 1;   // AUTHORED height: undo the puppet scale the body may already be wearing (a saved k would otherwise re-measure as 1)
  const eye = h.getNormalizedBoneNode?.('leftEye') ?? h.getNormalizedBoneNode?.('rightEye');
  if (eye) return (eye.getWorldPosition(new THREE.Vector3()).y - root) / ps;
  const head = h.getNormalizedBoneNode?.('head');
  return head ? (head.getWorldPosition(new THREE.Vector3()).y - root) / ps + 0.06 : null;   // eyes ≈ 6 cm above the head joint
}
function loadSavedScale() {
  try { const all = JSON.parse(localStorage.getItem(SCALE_LS) || '{}'); const name = getSelf()?.name ?? CONFIG.avatar ?? '';
    const v = all[name]; if (v && v.k > 0.5 && v.k < 1.7) { scaleState.k = v.k; scaleState.source = 'saved'; scaleState.eyeY = v.eyeY ?? null; } } catch {}
}
function saveScale() {
  try { const all = JSON.parse(localStorage.getItem(SCALE_LS) || '{}'); const name = getSelf()?.name ?? CONFIG.avatar ?? '';
    all[name] = { k: scaleState.k, eyeY: scaleState.eyeY, t: Date.now() }; localStorage.setItem(SCALE_LS, JSON.stringify(all)); } catch {}
}
function sampleDeviceScale(hmdY) {
  if (scaleState.locked) return;
  if (hmdY > 0.5) { if (!scaleState.samples.length) scaleState.firstAt = performance.now(); scaleState.samples.push(hmdY); }
  // lock at 120 samples, or after 3 s with at least 30 (porch's floor) — a slow
  // frame rate (SwiftShader headless: ~3 fps) must not postpone it forever
  const n = scaleState.samples.length;
  if (n < 120 && !(n >= 30 && performance.now() - scaleState.firstAt >= 3000)) return;
  const s = [...scaleState.samples].sort((a, b) => a - b); const med = s[s.length >> 1];
  const eye = avatarEyeY();
  scaleState.locked = true;
  if (!eye || med < 0.5) { tee(`[xr] scale not measured (eye=${eye?.toFixed?.(2)} med=${med.toFixed(2)}) — keeping ${scaleState.source} ${scaleState.k.toFixed(2)}`); return; }
  scaleState.k = Math.min(1.6, Math.max(0.6, eye / med)); scaleState.source = 'measured'; scaleState.eyeY = eye;
  saveScale();
  tee(`[xr] scale=${scaleState.k.toFixed(3)} (measured: avatar eye ${eye.toFixed(2)} m / your eye ${med.toFixed(2)} m, ${s.length} samples)`);
  bus.emit('xr:scale', xrScale());
}
let session = null;
export const isPresenting = () => presenting;

// ---- tuning (exultation XR_DEFAULTS, ported values) ------------------------
// ---- VR preferences (Settings › VR; R, 09-05 18:22). Persisted per browser.
// turn: 'snap' | 'smooth' · vignette: comfort tunnel on move/turn · mirror:
// what the desktop window shows while presenting — 'off' | 'first' | 'third'.
const PREF_XR = 'ew-xr-prefs';
export const xrPrefs = (() => { try { return { turn: 'snap', vignette: false, mirror: 'off', seated: false, ...JSON.parse(localStorage.getItem(PREF_XR) || '{}') }; } catch { return { turn: 'snap', vignette: false, mirror: 'off', seated: false }; } })();
{ const m = new URLSearchParams(location.search).get('mirror'); if (m === 'off' || m === 'first' || m === 'third') xrPrefs.mirror = m; }   // URL override for A/B (R's 'pop to origin' hunt, 09-05 21:46)
export function setXrPref(k, v) { xrPrefs[k] = v; try { localStorage.setItem(PREF_XR, JSON.stringify(xrPrefs)); } catch {} bus.emit('xr:prefs', xrPrefs); }
const DEADZONE = 0.18;
const SNAP_DEG = 30;
const SMOOTH_TURN_RAD_S = 2.2;   // ~126°/s at full deflection
const snapState = { cooling: false };
const dead = (v, dz = DEADZONE) => {
  if (!Number.isFinite(v)) return 0;   // a NaN axis (Frame controller waking, 09-05 23:13) must read as centred, not poison the walk
  const m = Math.abs(v);
  return m < dz ? 0 : Math.sign(v) * ((m - dz) / (1 - dz));
};
const pickAxis = (a, b) => (typeof a === 'number' && a !== 0 ? a : (b ?? 0));

// ---- controllers -----------------------------------------------------------
const hands = { left: null, right: null };   // {grip, ray, laser} — resolved by HANDEDNESS
// three's controller slots 0/1 are enumeration order, NOT left/right (porch-old
// index.html:5395 learned this; R, 09-05 20:00: 'hands attached to the wrong
// controller'). Each slot listens to its own 'connected' event and files itself
// under e.data.handedness; until then slot 0 = left, 1 = right as a guess.
const slots = [null, null];
function fileHand(slotIdx, handedness) {
  const h = slots[slotIdx]; if (!h) return;
  if (handedness !== 'left' && handedness !== 'right') return;
  for (const k of ['left', 'right']) if (hands[k] === h && k !== handedness) hands[k] = null;
  hands[handedness] = h;
  tee(`[xr] slot ${slotIdx} is the ${handedness} hand`);
}
const _v = new THREE.Vector3(); const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(); const _m = new THREE.Matrix4();

function makeHand(i) {
  const grip = renderer.xr.getControllerGrip(i);
  const ray = renderer.xr.getController(i);
  grip.addEventListener('connected', (e) => { tee(`[xr] slot ${i} grip connected handedness=${e.data?.handedness} profiles=${JSON.stringify(e.data?.profiles ?? [])}`); fileHand(i, e.data?.handedness); });
  ray.addEventListener('connected', (e) => fileHand(i, e.data?.handedness));
  // visible hand: a small warm knuckle-box (models can come later; presence first)
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.035, 0.09),
    new THREE.MeshStandardMaterial({ color: 0xe8c9a0, roughness: 0.8 }));
  grip.add(box);
  // the pointer: a thin laser that only shows on the right hand when aiming
  const laser = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.65 }));
  laser.visible = false;
  ray.add(laser);
  rig.add(grip); rig.add(ray);
  return { grip, ray, laser };
}

/** Guarded rumble (porch-old _haptic): silently a no-op on pads without
 *  actuators. Staging doctrine per HIGGS: touch = light tick, take = firmer. */
export function haptic(hand, val = 0.4, ms = 24) {
  try {
    if (!session) return;
    for (const src of session.inputSources)
      if (src.handedness === hand) src.gamepad?.hapticActuators?.[0]?.pulse(val, ms);
  } catch { /* never let feedback break the frame */ }
}

function sourceFor(hand) {
  if (!session) return null;
  for (const src of session.inputSources) if (src.handedness === hand) return src;
  return null;
}

// ---- pointer: right-hand ray → entity, trigger selects ---------------------
const _rc = new THREE.Raycaster();
function rayHitEntity(handRay, far = 24) {
  _m.identity().extractRotation(handRay.matrixWorld);
  _rc.ray.origin.setFromMatrixPosition(handRay.matrixWorld);
  _rc.ray.direction.set(0, 0, -1).applyMatrix4(_m);
  _rc.far = far;
  const roots = [...entities.values()].filter(Boolean);
  const hit = _rc.intersectObjects(roots, true)[0];
  let n = hit?.object;
  while (n && !n.userData.entityId) n = n.parent;
  return n ? { id: n.userData.entityId, dist: hit.distance, point: hit.point } : null;
}


// ---- grab: grip+trigger chord (HIGGS — grip aims, chord takes) -------------
let held = null;   // {id, hand, prevParent, prevPlace}
function tryGrab(hand) {
  const h = hands[hand];
  // a panel under the laser is taken before the world is (C17) — same precedence as a click
  { const q = xrPanelsGrab(h.ray);
    if (q) { held = { quad: q, hand }; haptic(hand, 0.4, 30); h.grip.attach(q.mesh); flashHint(`holding the ${q.id} panel — release grip to place it`); return; } }
  // near first (within reach of the grip), then ray (far-grab glides to hand)
  let target = null;
  h.grip.getWorldPosition(_v);
  let best = 0.45;
  for (const [id, obj] of entities) {
    obj.getWorldPosition(_v2);
    const d = _v.distanceTo(_v2);
    if (d < best) { best = d; target = id; }
  }
  if (!target) target = rayHitEntity(h.ray)?.id ?? null;
  if (!target) return;
  const obj = entities.get(target);
  if (!obj) return;
  const prevPlace = {
    id: target,
    pos: [+obj.position.x.toFixed(3), +obj.position.y.toFixed(3), +obj.position.z.toFixed(3)],
    yaw: +obj.rotation.y.toFixed(4),
    scale: +obj.scale.x.toFixed(3),
  };
  held = { id: target, hand, prevParent: obj.parent, prevPlace };
  haptic(hand, 0.55, 40);           // the take, felt
  h.grip.attach(obj);              // preserves world transform; it rides the hand
  flashHint(`holding ${target} — release grip to place`);
}

function releaseGrab() {
  if (!held) return;
  if (held.quad) {   // a panel: back to the rig where it visually is, uprighted; no verb — panels aren't world entities
    const p = xrPanelRelease(held.quad, rig);
    tee(`[xr] panel ${held.quad.id} placed at rig ${p.pos.join(',')} yaw ${p.yaw} pitch ${p.pitch}`);
    held = null; return;
  }
  const obj = entities.get(held.id);
  const { prevParent, prevPlace } = held;
  if (obj) {
    prevParent.attach(obj);        // back to the world, where it visually is
    const args = {
      id: held.id,
      pos: [+obj.position.x.toFixed(3), +obj.position.y.toFixed(3), +obj.position.z.toFixed(3)],
      yaw: +obj.rotation.y.toFixed(4),
      scale: prevPlace.scale,
    };
    pushUndo({ verb: 'place', args: prevPlace }, `moving ${held.id}`);   // the grab becomes a sentence; undo can unsay it
    sendVerb('place', args);
    flashHint(`placed ${held.id}`);
  }
  held = null;
}

// ---- radial menu: right-stick press opens, stick aims, release commits -----
// Every slot is verb-backed — an agent can speak each of these; the ring is
// just a hand-shaped way to say them. The dock has no body in VR: this ring
// is the dock, and 'panels' toggles the schema quads xrpanels.js carries.
/** The ring IS the dock rendered radially (R, 09-04 22:02): the same pins, in
 *  the same order, each slot opening that frame's quad. Rebuilt on every open
 *  so a pin toggled on the desk shows up here. The pinned trio glyphs lead,
 *  drawn from their own SVGs so the ring and the rail cannot drift; a frame
 *  with no VR surface yet is still a slot — dim, and honest about it — because
 *  parity means the gap is visible until the sweep fills it. sit/lie live in
 *  the emote quad now, not here. */
function radialEntries() {
  const out = [];
  if (glyphPinned('mic')) out.push({ svg: micGlyph(52), label: 'mic', on: micLive, act: () => bus.emit('xr:mic') });
  if (glyphPinned('ear')) out.push({ svg: earGlyph(52), label: 'ears', on: earOn, act: () => flipEar() });
  out.push({ svg: xrGlyph(52), label: 'leave VR', on: () => true, act: () => leaveVR('ring') });   // ALWAYS on the ring: an exit must not depend on a desktop pin (R 09-06 12:00: 'no way to leave VR at all')
  out.push({ svg: RECENTRE_SVG, label: 'recentre', on: () => false, act: () => recentreXR('ring') });   // C15: the playspace verb — always on the ring while presenting
  out.push({ icon: 'boxes', label: 'panels', on: () => xrPanelsShown(), act: () => { bus.emit('xr:panels'); tee('[xr] panels toggled (ring)'); } });   // hide / show every quad
  for (const e of dockPins()) {
    const has = xrPanelHas(e.id);
    out.push({ icon: e.icon, label: e.id, has, on: () => xrPanelOpen(e.id),
      act: () => { if (has) showXRPanel(e.id); else tee(`[xr] ring: ${e.id} has no VR surface yet`); } });
  }
  return out;
}
const RECENTRE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 26 26" fill="none" stroke="#f2f7f5" stroke-width="1.6" stroke-linecap="round"><circle cx="13" cy="13" r="7"/><circle cx="13" cy="13" r="1.6" fill="#f2f7f5"/><path d="M13 2v4M13 20v4M2 13h4M20 13h4"/></svg>';
// THE RING as a MENU — porch-old's NESTED RADIAL v2 rules (index.html:7592–7770, Nix in-headset
// 2026-07-12/14/15), eidoverse's tokens, the same slots as before (R 09-06 12:49–12:50):
//   · rides the RIGHT GRIP, anchored over the THUMB (0, +5 cm, +1 cm) — the digit making the choice;
//   · billboarded to the eyes every frame with HEADSET-up (wrist roll can't tilt it); de-rolled from the grip;
//   · R = 7.5 cm, 5 cm icon planes (depthTest off, renderOrder 999) — it draws over the world;
//   · focus: the slot scales 1.4× and swaps to the brand ink; a focus-label PILL under the ring names it
//     (Nix 07-15: "add words to the hover menus when an option is focused");
//   · deflect > 0.5 selects a sector, release < 0.35 commits (the stick driver below), hold-to-open (updateXR).
// Ink from the page's tokens: brand seafoam #8fe8c8, fg #ebebe9, panel rgb(5 20 20).
const RING_R = 0.075, RING_ICON = 0.05, RING_ANCHOR = { x: 0, y: 0.05, z: 0.01 };
const INK = { brand: '#8fe8c8', fg: '#ebebe9', dim: 'rgba(235,235,233,.42)', panel: 'rgb(5, 20, 20)', rule: 'rgba(143,232,200,.45)' };
let radial = null;   // {group, slots[], entries[], sel, label:{mesh,cv,tx}}
function ringIconTexture(s, focused) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'); const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  // eidoverse cap: a soft panel disc so glyphs read against any world; brand ring when focused/on
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fillStyle = INK.panel; g.fill();
  g.lineWidth = focused ? 6 : 3; g.strokeStyle = focused ? INK.brand : INK.rule; g.stroke();
  const on = !!s.on?.();
  const ink = s.has === false ? INK.dim : (focused || on ? INK.brand : INK.fg);
  g.save(); g.translate(64, 64); g.fillStyle = ink; g.strokeStyle = ink;
  // drawn glyphs, never fillText(emoji) (icons.js header; discovered live 08-05). Phosphor at the
  // dock's weights; the trio + recentre from their own SVGs via an Image (async — the texture updates).
  if (s.svg) {
    const img = new Image();
    img.onload = () => { g.save(); g.translate(64, 64); g.drawImage(img, -30, -30, 60, 60); g.restore(); tex.needsUpdate = true; };
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(s.svg.replace(/stroke="#f2f7f5"/g, `stroke="${ink}"`).replace(/fill="#f2f7f5"/g, `fill="${ink}"`));
  } else if (!fillPath(g, s.icon, 60, (focused || on) ? 'fill' : 'line')) stroke(g, s.icon, 60);
  g.restore();
  return tex;
}
function ringLabel() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const tx = new THREE.CanvasTexture(cv); tx.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.0275), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthTest: false }));
  mesh.renderOrder = 1000; mesh.visible = false;
  return { mesh, cv, tx };
}
function setRingLabel(text) {
  const l = radial?.label; if (!l) return;
  const g = l.cv.getContext('2d'); g.clearRect(0, 0, 256, 64);
  if (text) {
    g.fillStyle = INK.panel; g.beginPath(); g.roundRect(28, 10, 200, 44, 14); g.fill();
    g.strokeStyle = INK.rule; g.lineWidth = 2; g.stroke();
    g.font = '600 28px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK.fg; g.fillText(text, 128, 33);
  }
  l.mesh.visible = !!text; l.tx.needsUpdate = true;
}
function makeRadial(entries) {
  const group = new THREE.Group();
  const N = Math.max(1, entries.length);
  const slots = entries.map((s, i) => {
    const a = -Math.PI / 2 + i * (2 * Math.PI / N);   // porch: -π/2 first (top), then clockwise, placed at (cos a, −sin a)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(RING_ICON, RING_ICON), new THREE.MeshBasicMaterial({ map: ringIconTexture(s, false), transparent: true, depthTest: false }));
    m.renderOrder = 999; m.position.set(Math.cos(a) * RING_R, -Math.sin(a) * RING_R, 0); m.userData.ring = a;
    group.add(m); return m;
  });
  const label = ringLabel(); label.mesh.position.set(0, -RING_R - 0.03, 0); group.add(label.mesh);
  return { group, slots, entries, sel: -1, label };
}
function disposeRadial() {
  if (!radial) return;
  for (const m of radial.slots) { m.material.map?.dispose(); m.material.dispose(); m.geometry.dispose(); }
  radial.label.mesh.material.map?.dispose(); radial.label.mesh.material.dispose();
  radial.group.parent?.remove(radial.group); radial = null;
}
function openRadial() {
  disposeRadial();                       // rebuilt every open: the rail is the source of truth and it changes
  radial = makeRadial(radialEntries());
  hands.right.grip.add(radial.group);
  radial.group.position.set(RING_ANCHOR.x, RING_ANCHOR.y, RING_ANCHOR.z);
  radial.group.quaternion.identity();
  tickRadial();
}
function closeRadial(commit) {
  if (!radial) { radialOpen = false; return; }
  const act = commit && radial.sel >= 0 ? radial.entries[radial.sel]?.act : null;
  disposeRadial(); radialOpen = false;
  if (act) act();
}
const _rc1 = new THREE.Vector3(), _rc2 = new THREE.Vector3(), _rq1 = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rm = new THREE.Matrix4();
/** per frame while open: top-up billboard to the eyes, de-rolled from the grip (porch-old _radialTick) */
function tickRadial() {
  if (!radial) return;
  const grip = hands.right?.grip; if (!grip) return;
  if (radial.group.parent !== grip) { grip.add(radial.group); radial.group.position.set(RING_ANCHOR.x, RING_ANCHOR.y, RING_ANCHOR.z); }
  const xc = renderer.xr.getCamera();
  _rc1.setFromMatrixPosition(xc.matrixWorld);                       // the eyes
  radial.group.getWorldPosition(_rc2);
  _rq1.setFromRotationMatrix(xc.matrixWorld);
  const headUp = _v2.set(0, 1, 0).applyQuaternion(_rq1);
  _rm.lookAt(_rc1, _rc2, headUp); _rq1.setFromRotationMatrix(_rm);   // eye=camera, target=group (porch's known-good order)
  grip.getWorldQuaternion(_rq2).invert();
  radial.group.quaternion.copy(_rq2.multiply(_rq1));
}
function aimRadial(x, y) {
  if (!radial) return;
  const mag = Math.hypot(x, y);
  let best = -1;
  if (mag > 0.5) {
    // porch: stick angle atan2(y, x) against each slot's ring angle (gamepad y is inverted, which matches the −sin placement)
    const a = Math.atan2(y, x); let bd = 9;
    radial.slots.forEach((m, i) => { const d = Math.abs(Math.atan2(Math.sin(a - m.userData.ring), Math.cos(a - m.userData.ring))); if (d < bd) { bd = d; best = i; } });
  } else if (mag >= 0.35) best = radial.sel;   // hysteresis band: keep the selection, don't commit yet
  if (best !== radial.sel) {
    radial.slots.forEach((m, i) => { const foc = i === best; m.scale.setScalar(foc ? 1.4 : 1); m.material.map?.dispose(); m.material.map = ringIconTexture(radial.entries[i], foc); m.material.needsUpdate = true; });
    radial.sel = best;
    setRingLabel(best >= 0 ? radial.entries[best].label : null);
    if (best >= 0) haptic('right', 0.15, 10);
  }
}
let radialOpen = false, stickPressWas = false;
const triggerWas = { left: false, right: false };
// Buttons are NOT trusted for the first 700 ms after an input source appears: the gamepad's first
// frames report pressed=true garbage (R 09-06 11:35: 'panels toggled' fired by itself, sandwiched
// between the two connect lines; same family as the NaN axis). Edges inside the window are swallowed.
let inputsSettledAt = 0;
const buttonsTrusted = () => performance.now() > inputsSettledAt;

// ---- session ---------------------------------------------------------------
async function enterVR() {
  try {
    // THE LADDER (R's first tee line, 09-04 23:20: Chrome 152 granted the
    // session WITHOUT the optional 'webgpu' feature and three refused it —
    // "WebGPU XR sessions require the webgpu session feature"). On a WebGPU
    // backend the feature is REQUIRED: a browser that can't grant it rejects
    // the request, and we reload onto the WebGL backend (?webgl=1), where
    // three's classic XRWebGLLayer path runs (and keeps MSAA — the porch A/B).
    // 'layers' deliberately absent on that path.
    const gpu = !!renderer.backend?.isWebGPUBackend;
    const optionalFeatures = ['local-floor', 'bounded-floor', 'hand-tracking'];
    try {
      session = await navigator.xr.requestSession('immersive-vr',
        gpu ? { requiredFeatures: ['webgpu'], optionalFeatures } : { optionalFeatures });
    } catch (e) {
      if (!gpu) throw e;
      tee(`[xr] webgpu session refused (${e?.name ?? ''} ${e?.message ?? e}) — reloading on the WebGL backend`);
      toast('no WebGPU VR here — reloading on WebGL', 'info', 6000);
      const u = new URL(location.href); u.searchParams.set('webgl', '1'); u.searchParams.set('xr', '1');
      setTimeout(() => { location.href = u; }, 1200);
      return;
    }
    renderer.xr.enabled = true;
    // Tier A6 (gap list 09-05): CHOOSE the floor reference space — before this it
    // was only requested, and three's default is 'local' (eye-level origin), so
    // the world's floor could sit anywhere relative to the real one. The type
    // must be set BEFORE setSession (three reads it as the session starts).
    const feats = session.enabledFeatures ?? [];
    const floor = feats.includes('local-floor') ? 'local-floor' : feats.includes('bounded-floor') ? 'bounded-floor' : null;
    try { renderer.xr.setReferenceSpaceType(floor ?? 'local'); } catch (e) { report('xr ref space', e); }
    floorSpace = floor;
    scaleState.samples.length = 0; scaleState.locked = false; scaleState.firstAt = 0; scaleState.k = 1; scaleState.source = 'fallback'; loadSavedScale();
    const tReq = performance.now();
    await renderer.xr.setSession(session);
    entryClock = { t0: performance.now(), setSessionMs: +(performance.now() - tReq).toFixed(0), frames: [], last: 0, programs: 0, programMs: 0, pipelines: 0 };
    // ENTRY PROBE (R 09-06 13:35: 'might need a better probe'): count + time every program/pipeline the
    // backend builds while the entry clock runs — the 3 s first frame becomes 'N programs in X ms'.
    { const be = renderer.backend; if (be && !be.__entryProbe) { be.__entryProbe = true;
        for (const [k, field] of [['createProgram', 'programs'], ['createRenderPipeline', 'pipelines']]) { const orig = be[k]?.bind(be); if (!orig) continue;
          be[k] = (...a) => { const t = performance.now(); try { return orig(...a); } finally { if (entryClock) { entryClock[field]++; if (field === 'programs') entryClock.programMs += performance.now() - t; } } }; } } }
    // ENTRY CURTAIN (R 09-06 13:34: 'a bespoke loading screen to cover the WebXR construct'): the first
    // presenting frames draw a cheap curtain to the eyes while the WHOLE scene compiles against the real
    // XR camera + target (compileAsync from inside an XR frame captures that context — the 13:20 pre-warm
    // into a plain RT missed the pipeline key). The world appears when the compile resolves; 6 s fallback.
    setXRCurtain(true); curtainState = { armed: true, t0: performance.now() };
    if (!floor) tee('[xr] NO floor reference space granted — using local (eye-level origin); floor height is a guess');
    const onLine = `[xr] session on ${renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL'} refspace=${floor ?? 'local'} features=${JSON.stringify(session.enabledFeatures ?? [])}`;
    console.log(onLine); tee(onLine);
    try { renderer.xr.setFoveation(0); } catch { /* not all runtimes */ }
    rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
    recentre.x = recentre.z = recentre.y = 0; recentre.pending = true;   // fold the head's playspace pose in on the first tracked frame (C15)
    rig.rotation.y = wrapPi(myState.yaw);   // headset-forward = body-forward at entry, WRAPPED (R's recorder: root/rig 7.88 vs cam −1.6 → the pop)
    scene.add(rig);
    rig.add(camera);
    slots[0] ??= makeHand(0); slots[1] ??= makeHand(1);
    hands.left ??= slots[0]; hands.right ??= slots[1];   // guess until 'connected' files them by handedness
    presenting = true; bus.emit('xr:state');
    // SHADER ERROR TEE: a material that fails to compile/link in the eye buffers' context draws black
    // and the WebGL backend only console.error()s it — invisible from Burrow. First 6 such lines tee.
    if (!consoleTapped) { consoleTapped = true; for (const k of ['error', 'warn']) { const orig = console[k].bind(console);
      console[k] = (...a) => { try { const m = a.map((x) => (typeof x === 'string' ? x : x?.message ?? '')).join(' '); if (presenting && shaderTees < 6 && /shader|program|link|compile|GLSL|uniform|invalid/i.test(m)) { shaderTees++; tee(`[xr] console.${k}: ${m.slice(0, 300)}`); } } catch {} orig(...a); }; } }
    // WE own the stereo camera update (render.js renderWorld → xr.updateCamera(camera)). With
    // cameraAutoUpdate on, three rebuilt cameraXR inside EVERY renderer.render() while presenting —
    // including ShadowNode's nested render with the light camera (parent null) → the eyes at the
    // playspace origin (R's Frame, 09-05 21:45–23:45: 'I pop to the origin', view-dependent).
    renderer.xr.cameraAutoUpdate = false;
    // three.webgpu also hands the shadow pass cameraXR instead of the light camera while presenting
    // (Renderer.js: camera = xr.getCamera() for any render) — shadow maps are wrong by construction
    // in XR, and cost a full scene pass per light per frame. Off while presenting; ?xrshadows=1 keeps them.
    shadowsWere = renderer.shadowMap?.enabled ?? false;
    if (renderer.shadowMap && !new URLSearchParams(location.search).has('xrshadows')) renderer.shadowMap.enabled = false;   // the HUD visor repaints (R 22:04: 'VR icon still inactive')
    xrIntent.active = true;
    selfFirstPerson(true);
    xrPanelsEnter(rig);            // every registered frame as a physical surface
    session.addEventListener('end', () => {
      presenting = false; bus.emit('xr:state'); eyeBase = null; setXRCurtain(false); curtainState = null;
      renderer.xr.cameraAutoUpdate = true; if (renderer.shadowMap) renderer.shadowMap.enabled = shadowsWere;
      xrIntent.active = false;
      selfFirstPerson(false);
      { const v = getSelf()?.vrm; if (v) { v.scene.scale.setScalar(1); if (v.userData) { v.userData.ankleH = null; v.userData._gait = null; } } }   // the puppet scale is a presenting thing
      xrPanelsExit(rig);
      releaseGrab();
      rig.remove(camera);
      scene.remove(rig);
      session = null;
      camera.position.set(3.5, 2.6, 5.5);
      // FISHEYE FIX (porch-old :925): WebXR overwrote the projection with the
      // HMD's ~110° matrices; position alone leaves the desktop view fisheyed.
      camera.fov = 60; camera.aspect = innerWidth / innerHeight; camera.zoom = 1;
      camera.updateProjectionMatrix();
      // Defensive: the canvas back to the window's size and ratio (three restores its own record; ours is the truth)
      try { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); } catch (e) { report('xr exit resize', e); }
      // AFTER-EXIT INSTRUMENT (R 09-06 12:46 + 13:20: 'black desktop after leaving VR, the world is inoperable'):
      // at +0.5 s and +3 s, tee what the desktop actually is — is the loop running, what did the last frame
      // draw, where is the camera, what size is the canvas, and a REAL pixel read of the canvas centre.
      const f0 = perf.frames ?? 0;
      const probe = (tag) => {
        try {
          const cv = renderer.domElement; const ctx = document.createElement('canvas').getContext('2d'); ctx.canvas.width = 8; ctx.canvas.height = 8;
          let mean = null; try { ctx.drawImage(cv, cv.width * 0.4, cv.height * 0.4, cv.width * 0.2, cv.height * 0.2, 0, 0, 8, 8); const d = ctx.getImageData(0, 0, 8, 8).data; let a = 0; for (let i = 0; i < d.length; i += 4) a += d[i] + d[i + 1] + d[i + 2]; mean = +(a / (d.length / 4) / 3).toFixed(1); } catch (e) { mean = `err:${e?.name}`; }
          const e = camera.matrixWorld.elements;
          tee(`[xr] after-exit ${tag}: frames+${(perf.frames ?? 0) - f0} draws ${renderer.info.render.calls} canvas ${cv.width}x${cv.height} css ${cv.clientWidth}x${cv.clientHeight} pr ${renderer.getPixelRatio()} cam ${[e[12], e[13], e[14]].map((v) => v.toFixed(1)).join(',')} parent ${camera.parent?.name ?? camera.parent?.type ?? 'none'} fov ${camera.fov} near/far ${camera.near}/${camera.far} rt ${renderer.getRenderTarget() ? 'SET' : 'canvas'} xr.enabled ${renderer.xr.enabled} presenting ${renderer.xr.isPresenting} hidden ${document.hidden} centrePx ${mean}`);
        } catch (e) { tee(`[xr] after-exit ${tag} probe threw: ${e?.message ?? e}`); }
      };
      setTimeout(() => probe('+0.5s'), 500); setTimeout(() => probe('+3s'), 3000);
    });
    // Controller census: log each input source's claimed profiles + layout
    // once. Devices with no registry entry (Steam Frame, 2026) still speak
    // xr-standard; this line is how we learn what they actually expose.
    session.addEventListener('inputsourceschange', (ev) => {
      if (ev.added?.length) inputsSettledAt = performance.now() + 700;
      for (const src of ev.added ?? []) {
        const g = src.gamepad;
        const inLine = `[xr] input: ${src.handedness} profiles=${JSON.stringify(src.profiles)} ${g ? `axes=${g.axes.length} buttons=${g.buttons.length} haptics=${g.hapticActuators?.length ?? 0}` : 'no-gamepad'}`;
        console.log(inLine); tee(inLine);
      }
    });
  } catch (e) {
    report('enter VR', e);
    // the failure must OUTLIVE the glance (R, 09-04: "didn't see the error
    // for very long") — a sticky toast with the actual message, 30 s
    toast(`VR failed to start: ${e?.message ?? e}`, 'err', 30000);
    tee(`[xr] ENTER FAILED: ${e?.name ?? ''} ${e?.message ?? e}`);
  }
}

/** The rig goes where the body is: the BODY's root offset by the head's playspace position (recentreXR),
 *  so the head — not the playspace origin — stands on myState.pos and turns pivot about the head. Called
 *  from xrbody BEFORE the head/arm solve (main.js runs `xrbody` inside updateMe, ahead of `xr`): read
 *  after the root moved but before the rig followed, the grips and the XR camera were one frame behind
 *  the body — at 4 m/s that is a 4–5 cm fore/aft error flipping sign every frame (R 09-06 12:53: 'hands
 *  stutter backwards and forwards while running'). Basis and porch-old both move the playspace first.
 *  Rebuilds the stereo camera from the fresh rig so the eye pose xrbody reads is this frame's. */
export function syncRigToBody() {
  if (!presenting) return;
  const c = Math.cos(rig.rotation.y), sn = Math.sin(rig.rotation.y);
  rig.position.set(myState.pos.x - (c * recentre.x + sn * recentre.z), myState.pos.y + recentre.y, myState.pos.z - (-sn * recentre.x + c * recentre.z));
  rig.updateMatrixWorld(true);
  renderer.xr.updateCamera(camera);
}
/** Per-frame while presenting. Order matters: read hands → fill intent →
 *  (controller.updateMe moves the body with THEIR loco) → rig follows body. */
function camYawWorld() { const e = renderer.xr.getCamera().matrixWorld.elements; return Math.atan2(-e[8], -e[10]); }   // world yaw of the HMD's -Z
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));   // every yaw write wraps: an unwrapped body yaw (7.88 = 1.6 + 2π on R's recorder) met a wrapped camera yaw and 'popped' a full turn
// ---- recentre / seated (gap list C15; Basis: seated suppresses height capture) ----------
// The headset sits wherever the human is in the playspace; the rig is the body's root. Without
// this the root stands on myState.pos while the visible body (eye-anchored under the head) stands
// a step away — colliders, the wire `p`, and every turn pivot are off by the human's drift. Recentre
// measures the head's RIG-LOCAL pose once and folds it into the rig every frame: head xz lands on
// myState.pos (turns then pivot about the head), and in seated mode the rig is lifted so the head
// reads at the avatar's standing eye height — the body stands, the knees don't bend for the rest
// of the session. Runs once on entry, and on the ring / Settings › VR verb. Pure math in
// recentreSolve (smoke/recentre-probe.mjs).
// NEVER yaw the rig for a body (Basis: the tracking space is only ever turned by the stick; a head
// that faces away from the root is the torso latch's job). An earlier version rotated the rig by
// (bodyYaw − headYaw) here — the camera is a child of the rig, so entering physically turned 60°
// would have spun the world 60° on frame one. Removed 09-06 10:48 before it was ever felt.
const recentre = { x: 0, y: 0, z: 0, pending: false };
/** @returns {{x,z,y}} rig-local head xz to fold in; y lift (seated only). No yaw: the rig is stick-only. */
export function recentreSolve({ headLocal, seated, standingEyeY }) {
  const y = seated && standingEyeY > 0.5 && headLocal.y > 0.3 ? standingEyeY - headLocal.y : 0;
  return { x: headLocal.x, z: headLocal.z, y };
}
const _hl = new THREE.Vector3();
export function recentreXR(why = 'verb') {
  if (!presenting) return false;
  const cam = renderer.xr.getCamera();
  _hl.setFromMatrixPosition(cam.matrixWorld);
  rig.updateMatrixWorld(true); rig.worldToLocal(_hl);           // head in rig space (the playspace, pre-offset)
  _hl.x += recentre.x; _hl.z += recentre.z; _hl.y -= recentre.y;  // undo the offset already folded in: rig-local == playspace
  if (![_hl.x, _hl.y, _hl.z].every(Number.isFinite)) return false;
  // A tracked head stands on a floor-referenced space at ~1–2 m and within a room of the origin. On the
  // first presenting frames the XR camera has NO pose yet — its matrix is still the desktop camera at the
  // world origin, so 'rig-local head' comes out as minus the rig's own position (R, 09-06 11:24: 'head at
  // playspace 3.43,0.00,-43.50' — 43 m folded into the rig on entry). Not a head: refuse, and if this was
  // the entry pass, try again next frame.
  if (_hl.y < 0.3 || _hl.y > 3 || Math.hypot(_hl.x, _hl.z) > 10) {
    if (why === 'entry') recentre.pending = true;
    else tee(`[xr] recentre (${why}) refused: head at playspace ${_hl.x.toFixed(2)},${_hl.y.toFixed(2)},${_hl.z.toFixed(2)} is not a tracked pose`);
    return false;
  }
  const eye = avatarEyeY();
  const r = recentreSolve({ headLocal: _hl, seated: !!xrPrefs.seated, standingEyeY: eye ? eye * puppetScale() : 0 });
  recentre.x = r.x; recentre.z = r.z; recentre.y = r.y;
  tee(`[xr] recentre (${why}): head at playspace ${r.x.toFixed(2)},${_hl.y.toFixed(2)},${r.z.toFixed(2)} folded in${r.y ? `; seated lift ${r.y.toFixed(2)} m` : ''}`);
  bus.emit('xr:recentre', { ...r, why });
  return true;
}
export const xrRecentre = () => ({ ...recentre });
/** The one exit. Every path (visor glyph, ring, controller hold) ends here and says so. */
export function leaveVR(why = 'verb') {
  if (!session) { tee(`[xr] leave (${why}): no session`); return false; }
  tee(`[xr] leave (${why})`);
  try { const p = session.end(); p?.catch?.((e) => tee(`[xr] leave (${why}) rejected: ${e?.message ?? e}`)); } catch (e) { tee(`[xr] leave (${why}) threw: ${e?.message ?? e}`); }
  return true;
}
// ENTRY CLOCK (R 09-06 12:08: 'a LONG time to enter VR, 5–6 s of bare WebXR construct'): from setSession
// resolving to our first presenting frame, then the first eight frame gaps — a compile stall shows as
// one huge gap; a runtime stall shows as the t0→first gap. One tee line, then it retires.
let entryClock = null;
let curtainState = null;   // { armed, t0 } — the compile kicks off on the first presenting frame
let eyeBase = null;
let consoleTapped = false, shaderTees = 0;
let turnMag = 0;                    // |stick-X| while smooth-turning — the vignette reads it
export const turnMagnitude = () => turnMag;
export function updateXR(dtSec = 1 / 72) {
  if (!presenting) { turnMag = 0; return; }
  renderCensusTick();
  // EYE WATCH (R 09-06 12:22: 'spontaneously each eye becomes extremely fish-eyed; right eye visible in the
  // left'): per frame, not per 5 s — the first sample is the baseline; any eye whose vertical fov moves
  // more than 5° or whose viewport changes shape tees ONE line with both eyes' fov, viewport, and the last
  // foreign render, then re-arms when it returns to baseline.
  { const cams = renderer.xr.getCamera().cameras ?? [];
    if (cams.length === 2) {
      const fov = cams.map((c) => 2 * Math.atan(1 / c.projectionMatrix.elements[5]) * 180 / Math.PI);
      const vp = cams.map((c) => c.viewport ? `${c.viewport.x | 0},${c.viewport.y | 0},${c.viewport.z | 0},${c.viewport.w | 0}` : '-').join(' | ');
      if (!eyeBase && fov.every(Number.isFinite)) eyeBase = { fov, vp, off: false };
      else if (eyeBase) {
        const off = fov.some((f, i) => Math.abs(f - eyeBase.fov[i]) > 5) || vp !== eyeBase.vp;
        if (off && !eyeBase.off) { tee(`[xr] EYES OFF: fov ${fov.map((f) => f.toFixed(1)).join('/')} (was ${eyeBase.fov.map((f) => f.toFixed(1)).join('/')}) vp ${vp} (was ${eyeBase.vp}) foreign ${JSON.stringify(renderCensusPeek())} camPlanes ${camera.near}/${camera.far}`); eyeBase.off = true; }
        else if (!off && eyeBase.off) { tee('[xr] eyes back to baseline'); eyeBase.off = false; }
      }
    } }
  if (curtainState?.armed) { curtainState.armed = false;
    const t0 = performance.now(); let done = false;
    const finish = (why) => { if (done) return; done = true; setXRCurtain(false); tee(`[xr] curtain down (${why}) after ${(performance.now() - t0).toFixed(0)} ms — programs ${entryClock?.programs ?? '?'} in ${(entryClock?.programMs ?? 0).toFixed(0)} ms, pipelines ${entryClock?.pipelines ?? '?'}`); };
    try { renderer.compileAsync(scene, renderer.xr.getCamera(), scene).then(() => finish('compiled'), (e) => { report('xr entry compile', e); finish('compile rejected'); }); }
    catch (e) { report('xr entry compile', e); finish('compile threw'); }
    setTimeout(() => finish('6 s fallback'), 6000); }
  if (entryClock) { const now = performance.now(); entryClock.frames.push(+(now - (entryClock.last || entryClock.t0)).toFixed(0)); entryClock.last = now;
    if (entryClock.frames.length >= 8) { tee(`[xr] entry: setSession ${entryClock.setSessionMs} ms; first frame +${entryClock.frames[0]} ms; next gaps ${entryClock.frames.slice(1).join(',')} ms; programs so far ${entryClock.programs} (${entryClock.programMs.toFixed(0)} ms), pipelines ${entryClock.pipelines}`); } }
  if (entryClock && performance.now() - entryClock.t0 > 12000) entryClock = null;   // the probe retires after 12 s
  if (!xrPrefs.seated) { const e = renderer.xr.getCamera().matrixWorld.elements; const hy = e[13] - rig.position.y - recentre.y; if (Number.isFinite(hy)) sampleDeviceScale(hy); }   // Basis: seated suppresses height capture
  sampleFingerCurl();
  if (recentre.pending) { recentre.pending = false; recentreXR('entry'); }

  // head yaw becomes the movement frame: stick-forward = where you look.
  // Read the -Z column of matrixWorld DIRECTLY: getWorldDirection() calls
  // updateWorldMatrix(), which clobbers the XR-set matrix and freezes forward
  // at north (porch-old :9948, a debugged-for-days bug — not a style choice).
  const me_ = camera.matrixWorld.elements;
  _v.set(-me_[8], -me_[9], -me_[10]);
  // NaN passes `< 1e-6` (every comparison with NaN is false): a frame whose
  // XR camera matrix is momentarily NaN (tracking loss, the hand-mesh
  // compile spike) poisoned camYaw → updateMe rotated the move vector by NaN
  // → myState.pos = [NaN, 0, NaN] → camera.far NaN → three threw in render
  // (R's recorder, 09-04 23:50). Keep the last good yaw on a bad frame.
  const yaw = Math.atan2(_v.x, _v.z) + Math.PI;
  if (Number.isFinite(yaw) && _v.lengthSq() > 1e-6) {
    setCamYaw(yaw);   // orbit yaw (= facing + π) for the walk direction ONLY; the body's yaw is not driven from here
  }

  // and if a NaN slipped into the body anyway, put it back on the last good
  // spot rather than let it poison every matrix downstream
  if (Number.isFinite(myState.pos.x) && Number.isFinite(myState.pos.z)) lastGood.copy(myState.pos);
  else { tee(`[xr] myState.pos NaN — restored to ${lastGood.x.toFixed(1)},${lastGood.z.toFixed(1)} (speed ${myState.speed}, camYaw ${camYaw}, intent ${xrIntent.fwd},${xrIntent.strafe})`); myState.pos.copy(lastGood); }
  // speed is a lerp accumulator: one NaN in it is permanent (every compare with NaN is false), and re-poisons pos every frame
  if (!Number.isFinite(myState.speed)) myState.speed = 0;
  if (!Number.isFinite(camYaw)) setCamYaw(0);

  // sticks → intent (deadzone-with-rescale; snap cooldown — exultation math)
  const L = sourceFor('left')?.gamepad, R = sourceFor('right')?.gamepad;
  if (L) {
    xrIntent.fwd = dead(-pickAxis(L.axes[3], L.axes[1]));
    xrIntent.strafe = dead(pickAxis(L.axes[2], L.axes[0]));
    // jump = A or X (porch-old: 'A / X = jump'; VRChat: A). No invented bindings on the sticks (R 09-06 12:37:
    // 'we shouldn't mess with the default VR affordances') — panels live on the ring.
    xrIntent.jump = !!L.buttons[4]?.pressed || !!R?.buttons[4]?.pressed;
  } else { xrIntent.fwd = 0; xrIntent.strafe = 0; xrIntent.jump = !!R?.buttons[4]?.pressed; }
  if (R) {
    const rx = dead(pickAxis(R.axes[2], R.axes[0]));
    const ry = dead(pickAxis(R.axes[3], R.axes[1]));
    const pressed = !!R.buttons[3]?.pressed;              // thumbstick click
    // HOLD / AIM / RELEASE — the standard ring (porch-old, VRChat): the ring is open exactly while the
    // stick is held; aim with the stick; releasing on a slot commits it, releasing on the centre cancels.
    // (R 09-06 12:40: back to standard — the 09-04 click-toggle stuck open for five minutes this morning.)
    // Grip while held cancels. Nothing can stay open: no press, no ring.
    const gripNow = !!R.buttons[1]?.pressed;
    if (pressed && !stickPressWas && buttonsTrusted()) { radialOpen = true; openRadial(); haptic('right', 0.35, 30); tee('[xr] ring open'); }
    else if (radialOpen && pressed) { if (gripNow) { closeRadial(false); tee('[xr] ring cancelled (grip)'); } else { aimRadial(rx, ry); tickRadial(); } }
    else if (radialOpen && !pressed) { const sel = radial?.sel ?? -1; closeRadial(true); tee(`[xr] ring released${sel >= 0 ? ` → ${radial?.entries[sel]?.label}` : ' (nothing)'}`); }
    turnMag = 0;
    if (radialOpen) { /* the ring owns the stick */ }
    else if (xrPrefs.turn === 'smooth') {
      // smooth turn: the rig yaws continuously with the stick (R's own mode)
      const d = dead(rx);
      if (d) rig.rotation.y = wrapPi(rig.rotation.y - d * SMOOTH_TURN_RAD_S * (dtSec ?? 1 / 72));
      turnMag = Math.abs(d);
    }
    else if (Math.abs(rx) > 0.6 && !snapState.cooling) {
      // snap turns the RIG — the world pivots around the body. camYaw belongs
      // to the head (head-following rewrites it every frame), and the camera
      // rides the rig, so the head's world yaw inherits the snap on its own.
      rig.rotation.y = wrapPi(rig.rotation.y - Math.sign(rx) * (SNAP_DEG * Math.PI) / 180);
      snapState.cooling = true;
    } else if (Math.abs(rx) < 0.3) snapState.cooling = false;
    stickPressWas = pressed;

    // pointer + grab chord on BOTH hands (Tier B7 — the left was a stick and one
    // button). Either hand can aim, select, and grab; one thing held at a time
    // (tryGrab knows which hand holds it). The ring stays on the right.
    for (const side of ['right', 'left']) {
      const G = side === 'right' ? R : L; const hand = hands[side];
      if (!G || !hand) continue;
      const grip = !!G.buttons[1]?.pressed, trig = !!G.buttons[0]?.pressed;
      hand.laser.visible = grip || trig;
      if (!buttonsTrusted()) { triggerWas[side] = trig; continue; }
      if (grip && trig && !held) tryGrab(side);
      if (!grip && held?.hand === side) releaseGrab();
      if (trig && !triggerWas[side] && !grip && !(radialOpen && side === 'right')) {
        // panels claim the laser before the world does — a click meant for a
        // stepper must never select the mountain behind it
        const panelDist = xrPanelsPick(hand.ray, true);
        if (panelDist != null) haptic(side, 0.3, 18);   // a button, felt
        if (panelDist == null) {
          const hit = rayHitEntity(hand.ray);
          if (hit) { bus.emit('xr:select', hit.id); flashHint(`→ ${hit.id}`); }
        }
      }
      if (hand.laser.visible) {
        const panelDist = xrPanelsPick(hand.ray, false);
        const hit = panelDist == null ? rayHitEntity(hand.ray, 40) : null;
        hand.laser.scale.z = panelDist ?? (hit ? hit.dist : 24);
      }
      triggerWas[side] = trig;
    }
  }

  // eye cameras see the first-person split, never the third-person head.
  // r185 re-derives per-eye masks from the BASE camera every frame
  // (XRManager: cameraXR.layers.mask = camera.layers.mask | 0b110), so the
  // r184-era per-eye enable() was stomped one frame later. Drive the BASE
  // camera instead and let three propagate. Restored on session end.
  if (fpVrm !== getSelf()?.vrm) selfFirstPerson(true);   // avatar swapped mid-session → chop the new head
  hookSelfDraws(); selfDrawnLast = selfDrawn; selfDrawn = 0;

  // the body moved by THEIR controller code; the rig goes where the body is
  // porch-old's rule (index.html:11034–11072, verified 09-05): the RIG IS STICK-ONLY. Nothing reads the head
  // and writes the rig or the body root; the VRM chases the head INSIDE the root (xrbody.js).
  // the rig is the BODY's root offset by the head's playspace position (recentreXR), so the
  // head — not the playspace origin — stands on myState.pos, and turns pivot about the head
  syncRigToBody();   // (again, after a snap/smooth turn above changed rig.rotation) — three's XRManager builds cameraXR from camera.parent.matrixWorld

  // three pushes camera.near/far into session.updateRenderState every frame
  // it changes; a non-finite value throws INSIDE render and the headset
  // freezes (R's tee, 09-04 23:50: "depthFar … non-finite"). Nothing of ours
  // writes camera.far directly, so restore sane planes and record what was
  // found — the writer is still being hunted.
  if (!Number.isFinite(camera.near) || !Number.isFinite(camera.far) || camera.far <= camera.near) {
    tee(`[xr] camera planes non-finite: near=${camera.near} far=${camera.far} — restored`);
    camera.near = 0.15; camera.far = 20000; camera.updateProjectionMatrix();
  }

  // FLIGHT RECORDER: one line every 5 s while presenting — numbers where a
  // headset gives adjectives ("janky", "no avatar"). Read it out of the
  // desktop console after the session.
  const now = performance.now();
  if (now - recAt > 5000) {
    recAt = now;
    const av = getSelf();
    const rec = JSON.stringify({
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl',
      fps: perf.fps, ms: +perf.ms.toFixed(1), worst: +perf.worst.toFixed(0), spikes: perf.spikes,
      body: av ? (av.vrm?.scene?.visible ? 'visible' : 'HIDDEN') : 'NONE',
      fp: !!fpVrm, headChop: !!choppedHead, selfDrawn: selfDrawnLast, camMask: camera.layers.mask,
      eyeMasks: (renderer.xr.getCamera().cameras ?? []).map((c) => c.layers.mask),   // what each eye may SEE
      eyeFov: (renderer.xr.getCamera().cameras ?? []).map((c) => +(2 * Math.atan(1 / c.projectionMatrix.elements[5]) * 180 / Math.PI).toFixed(1)),   // vertical fov per eye from the projection — a fisheye is a number here
      eyeVp: (renderer.xr.getCamera().cameras ?? []).map((c) => c.viewport ? [c.viewport.x, c.viewport.y, c.viewport.z, c.viewport.w].map((v) => +v.toFixed(0)) : null),
      renders: renderCensusTake(),   // max renderer.render() calls in one frame since the last line + the last foreign camera
      // 'pitch black' as numbers: my body's materials and the lights that should be lighting them
      mats: (() => { const out = {}; av?.vrm?.scene?.traverse((o) => { if (!o.isMesh || !o.visible) return; for (const m of [].concat(o.material ?? [])) { const k = `${m.constructor?.name ?? m.type}${m.isOutline ? ':outline' : ''}`; const e = out[k] ||= { n: 0, tex: 0, opaque: 0, needsUpdate: 0 }; e.n++; if (m.map) e.tex++; if (!m.transparent || m.opacity >= 0.99) e.opaque++; if (m.needsUpdate) e.needsUpdate++; } }); return out; })(),   // arrays flattened (multi-material bodies): 12:34's 'undefined / tex 0' was this counter, not the body
      lights: (() => { const l = []; scene.traverse((o) => { if (o.isLight) l.push(`${o.type.replace('Light', '')}:${+o.intensity.toFixed(2)}${o.visible ? '' : ':hidden'}`); }); return l.slice(0, 8); })(),
      env: !!scene.environment,
      fpSplit: (() => { const n = { fp: 0, tp: 0, both: 0, base: 0 }; av?.vrm?.scene?.traverse((o) => { if (!o.isMesh && !o.isSkinnedMesh) return; const f = o.layers.isEnabled(FP_LAYER), t = o.layers.isEnabled(TP_LAYER); n[f && t ? 'both' : f ? 'fp' : t ? 'tp' : 'base']++; }); return n; })(),   // a body whose meshes are ALL tp is invisible in FP by spec
      controllers: { L: !!sourceFor('left'), R: !!sourceFor('right'), trusted: buttonsTrusted(), bits: ['left', 'right'].map((h) => (sourceFor(h)?.gamepad?.buttons ?? []).map((b) => +!!b.pressed).join('')) },   // raw pressed bits per hand: a stuck-true button is visible here rig: [+rig.position.x.toFixed(1), +rig.position.y.toFixed(1), +rig.position.z.toFixed(1)],
      hands: { L: !!sourceFor('left'), R: !!sourceFor('right') }, held: held?.id ?? null,
      me: [+myState.pos.x.toFixed(1), +myState.pos.y.toFixed(1), +myState.pos.z.toFixed(1)], clip: myState.clip, seat: myState.seat?.id ?? null, ring: radialOpen,
      yaw: { cam: +camYawWorld().toFixed(2), rig: +rig.rotation.y.toFixed(2), root: +(av?.root?.rotation.y ?? 0).toFixed(2) },
      headLocal: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],   // the HMD in rig space: a pop is a number here
      hips: { yaw: +(xrBodyDebug().hipsYaw ?? 0).toFixed(2), follow: +(xrBodyDebug().follow ?? 0).toFixed(2) },   // Basis latch state on the hips bone
      mirror: xrPrefs.mirror,   // is the desktop mirror pass running this session?
      vignette: xrPrefs.vignette,
      rigWorld: (() => { const e = rig.matrixWorld.elements; return [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]; })(), rigAuto: rig.matrixAutoUpdate, rigWAuto: rig.matrixWorldAutoUpdate, sceneWAuto: scene.matrixWorldAutoUpdate,   // is the rig's WORLD matrix ever computed? (eyes at origin, 23:20)
      eyes: (() => { const xc = renderer.xr.getCamera(); return (xc.cameras ?? []).map((c) => { const e = c.matrixWorld.elements; return [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]; }); })(),   // PER-EYE world positions — what actually renders
      baseCam: (() => { const e = camera.matrixWorld.elements; return [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]; })(),
      pitch: +(() => { const e = renderer.xr.getCamera().matrixWorld.elements; return Math.asin(Math.max(-1, Math.min(1, -e[9]))); })().toFixed(2),   // HMD pitch (rad), + = looking up
      camWorld: (() => { const e = renderer.xr.getCamera().matrixWorld.elements; return [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]; })(),   // the EYES in world space — a 'pop to origin' that the rig doesn't show
      rootPos: av ? [+av.root.position.x.toFixed(2), +av.root.position.y.toFixed(2), +av.root.position.z.toFixed(2)] : null,
      vrmOff: av?.vrm ? [+av.vrm.scene.position.x.toFixed(2), +av.vrm.scene.position.y.toFixed(2), +av.vrm.scene.position.z.toFixed(2)] : null,   // the eye anchor's offset inside the root   // the facing triple (R's 'pop to origin' hunt, 09-05)
    });
    console.log('[xr:rec]', rec); tee(`[xr:rec] ${rec}`);
  }
}
let recAt = 0;

// XR PIPELINE PRE-WARM (entry clock, R 09-06 12:33: setSession 4 ms, first frame +45 ms, then ONE 5524 ms
// frame — every material compiling for the eye buffers' render context on the first presenting draw).
// On an XR boot, once my body is in, compile the whole scene ONCE into a render target shaped like the
// eye buffers (RGBA8, depth, 4× MSAA) while the desktop is still idle-waiting on the visor. If the
// pipeline cache keys match, entry loses the 5 s frame; the entry clock is the verdict either way.
let xrWarmed = false;
function warmXRPipelines() {
  if (xrWarmed || !XR_BOOT || presenting || !getSelf()?.vrm) return;
  xrWarmed = true;
  warm('xr pipelines', async () => {
    const rt = new THREE.RenderTarget(64, 64, { samples: 4, depthBuffer: true, stencilBuffer: false });
    const prev = renderer.getRenderTarget(); const t0 = performance.now();
    try { renderer.setRenderTarget(rt); await renderer.compileAsync(scene, camera, scene); }
    catch (e) { report('xr pipeline warm', e); }
    finally { renderer.setRenderTarget(prev); rt.dispose(); }
    tee(`[xr] pipelines pre-warmed for the eye buffers in ${(performance.now() - t0).toFixed(0)} ms`);
  }, { p: P_AMBIENT });
}
export async function initXR() {
  if (!navigator.xr) return;
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); }
  catch (e) { report('xr support probe', e); }
  if (!supported) return;

  // the third glyph of the mic/ear trio — the same ink, the same slot
  // layout, the same pin row in the ∃ menu (R, 09-04). Exists only here,
  // where the browser answered that a headset can present.
  // PRE-WARM the hand meshes: their first draw compiled two materials on the
  // frame the controllers arrived — a 0.5 s spike (R's recorder 09-04 23:50)
  // that is exactly the kind of frame whose camera matrix comes back NaN.
  // Build the hands now (controller groups exist without a session), park
  // them under the rig, and let the conductor compile them off-screen.
  slots[0] ??= makeHand(0); slots[1] ??= makeHand(1);
  hands.left ??= slots[0]; hands.right ??= slots[1];
  warm('xr hands', async () => {
    // the avatar warm's form: object + camera + the lit scene, frustumCulled
    // off so a parked (stale-matrix) mesh isn't culled out of the compile walk
    const meshes = []; rig.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) { m.frustumCulled = false; try { await renderer.compileAsync(m, camera, scene); } catch { /* fine */ } }
  }, { p: P_AMBIENT });

  if (XR_BOOT) { const iv = setInterval(() => { warmXRPipelines(); if (xrWarmed) clearInterval(iv); }, 500); }   // body arrives seconds after boot; poll until it does
  registerXrGlyph({
    // The XR boot goes to the WebGL backend EXPLICITLY. ?xr=1 alone sets renderer.xr.enabled before
    // init(), which on a WebGPU backend asks for an xrCompatible adapter — and on R's RTX / Chrome 152
    // that request never resolves (09-06 11:12: splash 'still waking after 20s', no engine, twice).
    // Every session that worked (09-05 evening, 8 boots) carried webgl=1; Chrome's WebGPU-XR is
    // still behind flags. When that changes, drop the second param here and in enterVR's fallback.
    onclick: () => { if (presenting) leaveVR('visor'); else if (XR_BOOT) enterVR(); else { const u = new URL(location.href); u.searchParams.set('xr', '1'); u.searchParams.set('webgl', '1'); location.href = u; } },
    live: () => presenting,
  });
  setXrProbe(() => presenting);
}

/** harness window */
export const xrDebug = () => {
  const ring = radialEntries().map((e) => ({ label: e.label, has: e.has !== false, on: !!e.on?.() }));
  const gp = new THREE.Vector3();
  hands.right?.grip.getWorldPosition(gp);
  return { ring,
    presenting, held: held?.id ?? null, radialOpen,
    radialSel: radial?.sel ?? null,
    rigYaw: +rig.rotation.y.toFixed(3),
    laserOn: hands.right?.laser.visible ?? false,
    gripWorld: [+gp.x.toFixed(2), +gp.y.toFixed(2), +gp.z.toFixed(2)],
  };
};
