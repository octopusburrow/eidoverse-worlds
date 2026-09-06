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
import { stroke, fillPath } from './icons.js';
import { xrPanelsEnter, xrPanelsExit, xrPanelsPick, showXRPanel, xrPanelHas, xrPanelOpen } from './xrpanels.js';
import { myState, xrIntent, setCamYaw, setXrProbe } from './controller.js';
import { entities } from './world.js';
import { sendVerb } from './net.js';
import { flashHint, toast } from './ui.js';
import { registerXrGlyph, glyphPinned, micGlyph, earGlyph, xrGlyph, micLive, earOn, flipEar } from './mictoggle.js';
import { dockPins } from './ui.js';
import { pushUndo } from './build.js';
import { perf } from './perf.js';
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
let fpVrm = null;   // which vrm the split ran on — re-runs after avatar swap,
                    // and retries from the frame loop when entry beat the load
function selfFirstPerson(on) {
  const av = getSelf();
  if (!av?.vrm) return;
  if (on && av.vrm.firstPerson && fpVrm !== av.vrm) {
    try {
      av.vrm.firstPerson.setup({ firstPersonOnlyLayer: FP_LAYER, thirdPersonOnlyLayer: TP_LAYER });
      camera.layers.enable(TP_LAYER);   // desktop view keeps seeing the head
      fpVrm = av.vrm;
    } catch (e) { report('firstPerson setup', e); }
  }
  if (av.label) av.label.visible = !on; // your own name is for OTHER eyes
}

const lastGood = new THREE.Vector3();
const rig = new THREE.Group();
export const xrRig = () => rig;   // xrbody.js scales tracked targets about it
export const xrHands = () => hands;   // { left, right }: { grip, ray, … } — xrbody.js reads grip world poses for arm IK
rig.name = 'xr-rig';
let presenting = false;
let floorSpace = null;              // 'local-floor' | 'bounded-floor' | null (fell back to 'local')
export const xrFloorSpace = () => floorSpace;

// ---- DeviceScale (Tier A5; porch-old index.html:6045–6057, Basis's provenance)
// Map the human's standing eye height onto the avatar's: median of the first
// 120 in-session HMD heights (> 0.5 m — a seated start or tracking garbage
// must not scale), k = avatarEyeY / median, clamped .6–1.6. Applied to the
// TRACKED targets (head/hand IK), never to the view — the human sees 1:1, the
// puppet's targets scale. Provenance says why you are this size; saved per
// avatar so the next session starts right (Basis: Fallback/Measured/Saved).
const SCALE_LS = 'ew-xr-scale';
const scaleState = { k: 1, source: 'fallback', samples: [], eyeY: null, locked: false, firstAt: 0 };
export const xrScale = () => ({ ...scaleState, samples: scaleState.samples.length });
// harness hook (?xrsim only): feed HMD heights without waiting on a slow headless frame rate
export const xrSimSample = (y) => { if (CONFIG.params.has('xrsim')) sampleDeviceScale(y); };
function avatarEyeY() {
  const av = getSelf(); const h = av?.vrm?.humanoid;
  if (!h) return null;
  const root = av.vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const eye = h.getNormalizedBoneNode?.('leftEye') ?? h.getNormalizedBoneNode?.('rightEye');
  if (eye) return eye.getWorldPosition(new THREE.Vector3()).y - root;
  const head = h.getNormalizedBoneNode?.('head');
  return head ? head.getWorldPosition(new THREE.Vector3()).y - root + 0.06 : null;   // eyes ≈ 6 cm above the head joint
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
export const xrPrefs = (() => { try { return { turn: 'snap', vignette: false, mirror: 'off', ...JSON.parse(localStorage.getItem(PREF_XR) || '{}') }; } catch { return { turn: 'snap', vignette: false, mirror: 'off' }; } })();
export function setXrPref(k, v) { xrPrefs[k] = v; try { localStorage.setItem(PREF_XR, JSON.stringify(xrPrefs)); } catch {} bus.emit('xr:prefs', xrPrefs); }
const DEADZONE = 0.18;
const SNAP_DEG = 30;
const SMOOTH_TURN_RAD_S = 2.2;   // ~126°/s at full deflection
const snapState = { cooling: false };
const dead = (v, dz = DEADZONE) => {
  const m = Math.abs(v);
  return m < dz ? 0 : Math.sign(v) * ((m - dz) / (1 - dz));
};
const pickAxis = (a, b) => (typeof a === 'number' && a !== 0 ? a : (b ?? 0));

// ---- controllers -----------------------------------------------------------
const hands = { left: null, right: null };   // {grip, ray, laser}
const _v = new THREE.Vector3(); const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(); const _m = new THREE.Matrix4();

function makeHand(i) {
  const grip = renderer.xr.getControllerGrip(i);
  const ray = renderer.xr.getController(i);
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

let triggerWasDown = false;

// ---- grab: grip+trigger chord (HIGGS — grip aims, chord takes) -------------
let held = null;   // {id, hand, prevParent, prevPlace}
function tryGrab(hand) {
  const h = hands[hand];
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
  if (glyphPinned('xr')) out.push({ svg: xrGlyph(52), label: 'leave VR', on: () => true, act: () => { try { session?.end?.(); } catch { /* already gone */ } } });
  for (const e of dockPins()) {
    const has = xrPanelHas(e.id);
    out.push({ icon: e.icon, label: e.id, has, on: () => xrPanelOpen(e.id),
      act: () => { if (has) showXRPanel(e.id); else tee(`[xr] ring: ${e.id} has no VR surface yet`); } });
  }
  return out;
}
let radial = null;   // {group, slots[], entries[], sel}
function makeRadial(entries) {
  const group = new THREE.Group();
  const N = Math.max(1, entries.length);
  const slots = entries.map((s, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const open = !!s.on?.();
    const ink = s.has === false ? 'rgba(242,247,245,.45)' : (open ? '#8fe8c8' : '#f2f7f5');
    const tex = new THREE.CanvasTexture(cv);
    // drawn glyphs, never fillText(emoji): that call silently paints NOTHING
    // on platforms missing the glyph (icons.js header; discovered live 08-05).
    // Phosphor at the dock's own weights (line at rest, fill when open);
    // the trio from its own SVG via an Image (async — the texture updates).
    g.save(); g.translate(64, 52); g.fillStyle = ink; g.strokeStyle = ink;
    if (s.svg) {
      const img = new Image();
      img.onload = () => { g.save(); g.translate(64, 52); g.drawImage(img, -26, -26, 52, 52); g.restore(); tex.needsUpdate = true; };
      img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(s.svg);
    } else if (!fillPath(g, s.icon, 52, open ? 'fill' : 'line')) stroke(g, s.icon, 52);
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '20px monospace'; g.fillStyle = s.has === false ? 'rgba(207,232,245,.45)' : '#cfe8f5'; g.fillText(s.label, 64, 104);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.setScalar(0.075);
    sp.position.set(Math.cos(a) * 0.13, Math.sin(a) * -0.13, 0);
    group.add(sp);
    return sp;
  });
  return { group, slots, entries, sel: -1 };
}
function openRadial() {
  // rebuilt every open: the rail is the source of truth and it changes
  if (radial) { for (const sp of radial.slots) { sp.material.map?.dispose(); sp.material.dispose(); } }
  radial = makeRadial(radialEntries());
  radial.sel = -1;
  hands.right.ray.add(radial.group);
  radial.group.position.set(0, 0.02, -0.18);
}
function closeRadial(commit) {
  if (!radial) return;
  if (commit && radial.sel >= 0) radial.entries[radial.sel]?.act();
  hands.right.ray.remove(radial.group);
  radialOpen = false;
}
function aimRadial(x, y) {
  // stick vector picks the slot; center = no selection
  const m = Math.hypot(x, y);
  // slot i sits at layout angle a_i = i·2π/N − π/2, placed at (cos a_i, −sin a_i):
  // on screen that is θ_i = π/2 − i·2π/N — up for slot 0, then clockwise.
  // The stick's screen angle is atan2(−y, x) (gamepad up is −y). Invert
  // θ_i for i. (The old form added π/2 instead of subtracting: stick-up
  // picked slot N/2 — R waved at the room for ten minutes, 09-04 23:43.)
  radial.sel = m < 0.45 ? -1 : (() => {
    const N = Math.max(1, radial.entries.length);
    const theta = Math.atan2(-y, x);
    const i = Math.round((Math.PI / 2 - theta) / (Math.PI * 2 / N));
    return ((i % N) + N) % N;
  })();
  radial.slots.forEach((sp, i) => sp.scale.setScalar(i === radial.sel ? 0.105 : 0.075));
}
let radialOpen = false, stickPressWas = false;

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
    await renderer.xr.setSession(session);
    if (!floor) tee('[xr] NO floor reference space granted — using local (eye-level origin); floor height is a guess');
    const onLine = `[xr] session on ${renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL'} refspace=${floor ?? 'local'} features=${JSON.stringify(session.enabledFeatures ?? [])}`;
    console.log(onLine); tee(onLine);
    try { renderer.xr.setFoveation(0); } catch { /* not all runtimes */ }
    rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
    rig.rotation.y = 0;
    scene.add(rig);
    rig.add(camera);
    hands.left ??= makeHand(0);
    hands.right ??= makeHand(1);
    presenting = true;
    xrIntent.active = true;
    selfFirstPerson(true);
    xrPanelsEnter(rig);            // every registered frame as a physical surface
    session.addEventListener('end', () => {
      presenting = false;
      xrIntent.active = false;
      camera.layers.enable(TP_LAYER); camera.layers.disable(FP_LAYER);
      selfFirstPerson(false);
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
    });
    // Controller census: log each input source's claimed profiles + layout
    // once. Devices with no registry entry (Steam Frame, 2026) still speak
    // xr-standard; this line is how we learn what they actually expose.
    session.addEventListener('inputsourceschange', (ev) => {
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

/** Per-frame while presenting. Order matters: read hands → fill intent →
 *  (controller.updateMe moves the body with THEIR loco) → rig follows body. */
let turnMag = 0;                    // |stick-X| while smooth-turning — the vignette reads it
export const turnMagnitude = () => turnMag;
export function updateXR(dtSec = 1 / 72) {
  if (!presenting) { turnMag = 0; return; }
  { const e = renderer.xr.getCamera().matrixWorld.elements; const hy = e[13] - rig.position.y; if (Number.isFinite(hy)) sampleDeviceScale(hy); }

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
  if (Number.isFinite(yaw) && _v.lengthSq() > 1e-6) setCamYaw(yaw);

  // and if a NaN slipped into the body anyway, put it back on the last good
  // spot rather than let it poison every matrix downstream
  if (Number.isFinite(myState.pos.x) && Number.isFinite(myState.pos.z)) lastGood.copy(myState.pos);
  else { tee(`[xr] myState.pos NaN — restored to ${lastGood.x.toFixed(1)},${lastGood.z.toFixed(1)}`); myState.pos.copy(lastGood); }

  // sticks → intent (deadzone-with-rescale; snap cooldown — exultation math)
  const L = sourceFor('left')?.gamepad, R = sourceFor('right')?.gamepad;
  if (L) {
    xrIntent.fwd = dead(-pickAxis(L.axes[3], L.axes[1]));
    xrIntent.strafe = dead(pickAxis(L.axes[2], L.axes[0]));
    xrIntent.jump = !!L.buttons[4]?.pressed;
  } else { xrIntent.fwd = 0; xrIntent.strafe = 0; xrIntent.jump = false; }
  if (R) {
    const rx = dead(pickAxis(R.axes[2], R.axes[0]));
    const ry = dead(pickAxis(R.axes[3], R.axes[1]));
    const pressed = !!R.buttons[3]?.pressed;              // thumbstick click
    // CLICK-TOGGLE, not hold (R in-headset 09-04: "small hands — hard to keep
    // it down and select"): one click opens the ring and it STAYS; aim with
    // the stick at leisure; a second click or the trigger commits; grip
    // cancels. Nothing commits on a release, so a spring-back can't pick.
    const trigNow = !!R.buttons[0]?.pressed, gripNow = !!R.buttons[1]?.pressed;
    if (pressed && !stickPressWas) {
      if (!radialOpen) { radialOpen = true; openRadial(); }
      else closeRadial(true);
    } else if (radialOpen) {
      if (trigNow && !triggerWasDown) closeRadial(true);
      else if (gripNow) closeRadial(false);
      else aimRadial(rx, ry);
    }
    turnMag = 0;
    if (radialOpen) { /* the ring owns the stick */ }
    else if (xrPrefs.turn === 'smooth') {
      // smooth turn: the rig yaws continuously with the stick (R's own mode)
      const d = dead(rx);
      if (d) rig.rotation.y -= d * SMOOTH_TURN_RAD_S * (dtSec ?? 1 / 72);
      turnMag = Math.abs(d);
    }
    else if (Math.abs(rx) > 0.6 && !snapState.cooling) {
      // snap turns the RIG — the world pivots around the body. camYaw belongs
      // to the head (head-following rewrites it every frame), and the camera
      // rides the rig, so the head's world yaw inherits the snap on its own.
      rig.rotation.y -= Math.sign(rx) * (SNAP_DEG * Math.PI) / 180;
      snapState.cooling = true;
    } else if (Math.abs(rx) < 0.3) snapState.cooling = false;
    stickPressWas = pressed;

    // pointer + grab chord on the right hand
    const grip = !!R.buttons[1]?.pressed, trig = !!R.buttons[0]?.pressed;
    hands.right.laser.visible = grip || trig;
    if (grip && trig && !held) tryGrab('right');
    if (!grip && held) releaseGrab();
    if (trig && !triggerWasDown && !grip && !radialOpen) {
      // panels claim the laser before the world does — a click meant for a
      // stepper must never select the mountain behind it
      const panelDist = xrPanelsPick(hands.right.ray, true);
      if (panelDist != null) haptic('right', 0.3, 18);   // a button, felt
      if (panelDist == null) {
        const hit = rayHitEntity(hands.right.ray);
        if (hit) { bus.emit('xr:select', hit.id); flashHint(`→ ${hit.id}`); }
      }
    }
    if (hands.right.laser.visible) {
      const panelDist = xrPanelsPick(hands.right.ray, false);
      const hit = panelDist == null ? rayHitEntity(hands.right.ray, 40) : null;
      hands.right.laser.scale.z = panelDist ?? (hit ? hit.dist : 24);
    }
    triggerWasDown = trig;
  }

  // eye cameras see the first-person split, never the third-person head.
  // r185 re-derives per-eye masks from the BASE camera every frame
  // (XRManager: cameraXR.layers.mask = camera.layers.mask | 0b110), so the
  // r184-era per-eye enable() was stomped one frame later. Drive the BASE
  // camera instead and let three propagate. Restored on session end.
  if (fpVrm !== getSelf()?.vrm) selfFirstPerson(true);
  if (fpVrm) { camera.layers.enable(FP_LAYER); camera.layers.disable(TP_LAYER); }

  // the body moved by THEIR controller code; the rig goes where the body is
  rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);

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
      fp: !!fpVrm, camMask: camera.layers.mask, rig: [+rig.position.x.toFixed(1), +rig.position.y.toFixed(1), +rig.position.z.toFixed(1)],
      hands: { L: !!sourceFor('left'), R: !!sourceFor('right') }, held: held?.id ?? null,
      me: [+myState.pos.x.toFixed(1), +myState.pos.y.toFixed(1), +myState.pos.z.toFixed(1)], clip: myState.clip, seat: myState.seat?.id ?? null, ring: radialOpen,
    });
    console.log('[xr:rec]', rec); tee(`[xr:rec] ${rec}`);
  }
}
let recAt = 0;

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
  hands.left ??= makeHand(0);
  hands.right ??= makeHand(1);
  warm('xr hands', async () => {
    // the avatar warm's form: object + camera + the lit scene, frustumCulled
    // off so a parked (stale-matrix) mesh isn't culled out of the compile walk
    const meshes = []; rig.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) { m.frustumCulled = false; try { await renderer.compileAsync(m, camera, scene); } catch { /* fine */ } }
  }, { p: P_AMBIENT });

  registerXrGlyph({
    onclick: () => { if (presenting) session?.end?.(); else if (XR_BOOT) enterVR(); else { const u = new URL(location.href); u.searchParams.set('xr', '1'); location.href = u; } },
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
