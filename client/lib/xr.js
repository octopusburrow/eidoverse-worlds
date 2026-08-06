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

import { THREE, renderer, camera, scene, CONFIG, XR_BOOT, report, bus } from './core.js';
import { xrPanelsEnter, xrPanelsExit, xrPanelsPick } from './xrpanels.js';
import { myState, xrIntent, setCamYaw, setXrProbe } from './controller.js';
import { entities, comps } from './world.js';
import { sendVerb } from './net.js';
import { flashHint } from './ui.js';
import { recordPair } from './editundo.js';

const rig = new THREE.Group();
rig.name = 'xr-rig';
let presenting = false;
let session = null;
export const isPresenting = () => presenting;

// ---- tuning (exultation XR_DEFAULTS, ported values) ------------------------
const DEADZONE = 0.18;
const SNAP_DEG = 30;
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
    recordPair({ verb: 'place', args: prevPlace }, { verb: 'place', args });
    sendVerb('place', args);       // the grab becomes a sentence; undo can unsay it
    flashHint(`placed ${held.id}`);
  }
  held = null;
}

// ---- radial menu: right-stick press opens, stick aims, release commits -----
// Every slot is verb-backed — an agent can speak each of these; the ring is
// just a hand-shaped way to say them. DOM panels don't exist in VR, so slots
// are world-actions only (satchel/build in VR ride a later 3D-UI slice).
const RADIAL = [
  { icon: '🪑', label: 'sit', act: () => bus.emit('xr:sit') },
  { icon: '🧍', label: 'stand', act: () => bus.emit('xr:stand') },
  { icon: '🎙', label: 'mic', act: () => bus.emit('xr:mic') },
  { icon: '👋', label: 'wave', act: () => sendVerb('say', { text: '👋' }) },
  { icon: '📌', label: 'here?', act: () => sendVerb('say', { text: `I'm at (${myState.pos.x.toFixed(0)}, ${myState.pos.z.toFixed(0)})` }) },
  { icon: '⛺', label: 'home', act: () => { myState.pos.set(0, 2, 0); flashHint('home'); } },
];
let radial = null;   // {group, slots[], sel}
function makeRadial() {
  const group = new THREE.Group();
  const slots = RADIAL.map((s, i) => {
    const a = (i / RADIAL.length) * Math.PI * 2 - Math.PI / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.icon, 64, 52);
    g.font = '20px monospace'; g.fillStyle = '#cfe8f5'; g.fillText(s.label, 64, 104);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    sp.scale.setScalar(0.075);
    sp.position.set(Math.cos(a) * 0.13, Math.sin(a) * -0.13, 0);
    group.add(sp);
    return sp;
  });
  return { group, slots, sel: -1 };
}
function openRadial() {
  if (!radial) radial = makeRadial();
  radial.sel = -1;
  hands.right.ray.add(radial.group);
  radial.group.position.set(0, 0.02, -0.18);
}
function closeRadial(commit) {
  if (!radial) return;
  if (commit && radial.sel >= 0) RADIAL[radial.sel].act();
  hands.right.ray.remove(radial.group);
  radialOpen = false;
}
function aimRadial(x, y) {
  // stick vector picks the slot; center = no selection
  const m = Math.hypot(x, y);
  radial.sel = m < 0.45 ? -1 : (() => {
    const a = Math.atan2(-y, x) + Math.PI / 2;                 // stick-up = slot 0
    const i = Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * RADIAL.length) % RADIAL.length;
    return i;
  })();
  radial.slots.forEach((sp, i) => sp.scale.setScalar(i === radial.sel ? 0.105 : 0.075));
}
let radialOpen = false, stickPressWas = false;

// ---- session ---------------------------------------------------------------
async function enterVR() {
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      // 'layers' deliberately ABSENT: three then uses classic XRWebGLLayer,
      // whose antialias defaults true → MSAA in VR (the porch A/B's finding).
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);
    try { renderer.xr.setFoveation(0); } catch { /* not all runtimes */ }
    rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
    rig.rotation.y = 0;
    scene.add(rig);
    rig.add(camera);
    hands.left ??= makeHand(0);
    hands.right ??= makeHand(1);
    presenting = true;
    xrIntent.active = true;
    xrPanelsEnter(rig);            // manifest + inspector as physical surfaces
    session.addEventListener('end', () => {
      presenting = false;
      xrIntent.active = false;
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
  } catch (e) {
    report('enter VR', e);
    flashHint('VR session failed — see console');
  }
}

/** Per-frame while presenting. Order matters: read hands → fill intent →
 *  (controller.updateMe moves the body with THEIR loco) → rig follows body. */
export function updateXR() {
  if (!presenting) return;

  // head yaw becomes the movement frame: stick-forward = where you look.
  // Read the -Z column of matrixWorld DIRECTLY: getWorldDirection() calls
  // updateWorldMatrix(), which clobbers the XR-set matrix and freezes forward
  // at north (porch-old :9948, a debugged-for-days bug — not a style choice).
  const me_ = camera.matrixWorld.elements;
  _v.set(-me_[8], -me_[9], -me_[10]);
  if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
  setCamYaw(Math.atan2(_v.x, _v.z) + Math.PI);

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
    if (pressed && !stickPressWas && !radialOpen) { radialOpen = true; openRadial(); }
    if (radialOpen) {
      // commit BEFORE re-aiming: on the release frame the stick is often
      // already back at center, and re-aiming first would select nothing —
      // the commit honors where you were pointing, not where the spring is.
      if (!pressed && stickPressWas) closeRadial(true);
      else aimRadial(rx, ry);
    } else if (Math.abs(rx) > 0.6 && !snapState.cooling) {
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
        if (hit) { bus.emit('sg:select-request', hit.id); flashHint(`→ ${hit.id}`); }
      }
    }
    if (hands.right.laser.visible) {
      const panelDist = xrPanelsPick(hands.right.ray, false);
      const hit = panelDist == null ? rayHitEntity(hands.right.ray, 40) : null;
      hands.right.laser.scale.z = panelDist ?? (hit ? hit.dist : 24);
    }
    triggerWasDown = trig;
  }

  // the body moved by THEIR controller code; the rig goes where the body is
  rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
}

export async function initXR() {
  if (!navigator.xr) return;
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); }
  catch (e) { report('xr support probe', e); }
  if (!supported) return;

  const b = document.createElement('button');
  b.className = 'panel xr-chip';
  b.style.cssText = 'position:fixed; top:10px; right:12px; z-index:30; font-size:14px; padding:8px 14px;';
  if (!XR_BOOT) {
    b.textContent = '🥽 VR';
    b.onclick = () => {
      const u = new URL(location.href); u.searchParams.set('xr', '1'); location.href = u;
    };
  } else {
    b.textContent = '🥽 enter VR';
    b.onclick = enterVR;
  }
  document.body.appendChild(b);
  setXrProbe(() => presenting);
}

/** harness window */
export const xrDebug = () => {
  const gp = new THREE.Vector3();
  hands.right?.grip.getWorldPosition(gp);
  return {
    presenting, held: held?.id ?? null, radialOpen,
    radialSel: radial?.sel ?? null,
    rigYaw: +rig.rotation.y.toFixed(3),
    laserOn: hands.right?.laser.visible ?? false,
    gripWorld: [+gp.x.toFixed(2), +gp.y.toFixed(2), +gp.z.toFixed(2)],
  };
};
