// xrbody — the body follows the headset (Tier A1 + A2 of the 09-05 gap list;
// porch-old index.html:6186–6236 ported, Basis's design). Before this, VR moved
// only the camera and the body's yaw: the VRM's head never tilted and the body
// stood wherever the controller put it, so a tall person floated above a
// short avatar and remotes saw a mannequin. Now, every presenting frame, AFTER
// the controller placed the root and BEFORE the render:
//   1. distributed look-at — the HMD's pitch / roll / residual yaw, expressed
//      relative to the body's facing, is spread over spine→chest→upperChest→
//      neck→head with porch's weights, damped, yaw faded near vertical gaze —
//      no single joint snaps;
//   2. eye anchor — the whole VRM is translated (root-local) by (hmd − eye), so
//      the avatar's eyes coincide with the headset by construction; the body
//      HANGS BENEATH the head. Order matters: after the look chain (the head
//      pose moves the eyes), before any arm solve (shoulders under the head).
// DeviceScale (xr.js) scales the tracked HMD target about the rig, not the view.
import { THREE, renderer } from './core.js';
import { CONFIG } from './base.js';
import { isPresenting, xrScale, xrRig, xrHands, xrFingerCurl } from './xr.js';

let getSelf = () => null;
let hooked = null;
export const bindXRBodySelf = (fn) => { getSelf = fn; };
// called each frame (system 'xrbody', early): make sure THIS frame's self avatar
// carries the hook — the avatar object changes on every body swap
export function ensureXRBodyHook() {
  const av = getSelf();
  if (!av || av === hooked) return;
  av.onBeforeVrmUpdate = (dt) => tickXRBody(dt);
  hooked = av;
}

const CHAIN = ['spine', 'chest', 'upperChest', 'neck', 'head'];
const wY = [0, 0, 0, .4, .6],   // residual yaw: neck + head only — the BODY already turned to the HMD (eido's controller does that); porch's torso share fought it
 wP = [.10, .12, .16, .26, .36], wR = [.08, .10, .14, .28, .40];
const look = new THREE.Vector3();          // damped pitch / yaw / roll
const hmdPos = new THREE.Vector3(), hmdQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
const qRel = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), qFlip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const eyeW = new THREE.Vector3(), delta = new THREE.Vector3(), rigQ = new THREE.Quaternion(), v1 = new THREE.Vector3();
const sa = (a) => Math.atan2(Math.sin(a), Math.cos(a));   // shortest-arc wrap

const dbg = { ticks: 0, notPresenting: 0, noSelf: 0, ran: 0, sim: false, hmdQ: null, pitchRaw: 0, arms: { left: false, right: false } };
const gripP = new THREE.Vector3(), gripQ = new THREE.Quaternion();
export const xrBodyDebug = () => ({ look: look.toArray().map((v) => +v.toFixed(3)), ...dbg });
// harness hook (?xrsim only): override the HMD pose xrbody reads. IWER's fake
// headset exposes no orientation setter, so the look-at math is tested by
// feeding the pose directly — the one input this module consumes.
let simHead = null;
export const xrSimHead = (pos, quat) => { if (CONFIG.params.has('xrsim')) simHead = pos ? { pos, quat } : null; };
const simGrip = { left: null, right: null };
export const xrSimGrip = (side, pos, quat) => { if (CONFIG.params.has('xrsim')) simGrip[side] = pos ? { pos, quat } : null; };

// ---- arm IK (Tier A3; porch-old index.html:5941 _solveArm + _aimBone) ------
// Two-bone solve per side to the controller grip: elbow interior angle clamped
// 23°–178° (Basis) so the wrist never snaps at full extension; the elbow pole
// is CHEST-LOCAL (down-and-back relative to the torso) so elbows stay right at
// any body yaw; the wrist takes the grip orientation through a per-hand
// calibration (porch's measured right, left = mirror). Emotes trump IK.
const WRIST_R = new THREE.Quaternion(0.5812875774993174, 0.7123369384133019, 0.08586779365740962, -0.38380664895827776);
const WRIST_L = new THREE.Quaternion(-WRIST_R.x, WRIST_R.y, WRIST_R.z, -WRIST_R.w).normalize();   // mirror across YZ
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _d = new THREE.Vector3(), _pole = new THREE.Vector3(), _axis = new THREE.Vector3(), _u = new THREE.Vector3(), _elbow = new THREE.Vector3(), _rest = new THREE.Vector3();
function aimBone(bone, targetWorld, childRestLocal) {
  bone.getWorldPosition(_p);
  bone.parent.getWorldQuaternion(_q).invert();
  _d.subVectors(targetWorld, _p).applyQuaternion(_q).normalize();
  bone.quaternion.setFromUnitVectors(_rest.copy(childRestLocal).normalize(), _d);
}
export function solveArm(vrm, side, targetPos, targetQuat) {
  const h = vrm.humanoid;
  const U = h.getNormalizedBoneNode(side + 'UpperArm'), L = h.getNormalizedBoneNode(side + 'LowerArm'), H = h.getNormalizedBoneNode(side + 'Hand');
  if (!U || !L || !H) return false;
  U.quaternion.identity(); L.quaternion.identity(); H.quaternion.identity();
  vrm.scene.updateMatrixWorld(true);
  const uPos = U.getWorldPosition(new THREE.Vector3());
  const l1 = L.position.length(), l2 = H.position.length();
  const toT = new THREE.Vector3().subVectors(targetPos, uPos);
  let d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.02);
  const E = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const Ec = THREE.MathUtils.clamp(E, 23 * Math.PI / 180, 178 * Math.PI / 180);
  if (Ec !== E) d = Math.sqrt(Math.max(1e-6, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(Ec)));
  const dir = toT.normalize();
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const chest = h.getNormalizedBoneNode('upperChest') || h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('spine');
  chest ? chest.getWorldQuaternion(_q) : _q.identity();
  _pole.set(side === 'left' ? 0.3 : -0.3, -1, -0.5).normalize().applyQuaternion(_q);
  _axis.crossVectors(dir, _pole);
  if (_axis.lengthSq() < 1e-6) _axis.set(0, 0, 1); else _axis.normalize();
  _u.copy(dir).applyAxisAngle(_axis, a);
  _elbow.copy(uPos).addScaledVector(_u, l1);
  aimBone(U, _elbow, L.position); vrm.scene.updateMatrixWorld(true);
  aimBone(L, targetPos, H.position); vrm.scene.updateMatrixWorld(true);
  if (targetQuat) {
    H.parent.getWorldQuaternion(_q).invert();
    H.quaternion.copy(_q.multiply(targetQuat).multiply(side === 'left' ? WRIST_L : WRIST_R));
  }
  return true;
}

// ---- finger curl (Tier A4; porch-old :5917–5939 verbatim) ------------------
// Index ← trigger, Middle/Ring/Little ← grip, across Proximal/Intermediate/
// Distal at [1.22, 1.57, 0.96] rad for a full fist, handed sign. ASSIGN base×
// curl every frame — never multiply onto last frame's result: nothing resets
// finger bones in VR, so an accumulated curl integrates into spin (porch's
// spinning-fingertips bug). Base quats are captured on first touch.
const CURL = [1.22, 1.57, 0.96];
const curlQ = new THREE.Quaternion(), curlE = new THREE.Euler();
const simCurl = { left: null, right: null };
export const xrSimCurl = (side, c) => { if (CONFIG.params.has('xrsim')) simCurl[side] = c ? { ...c } : null; };
function fingerTick(vrm) {
  const h = vrm.humanoid; if (!h) return;
  const ud = vrm.userData = vrm.userData || {};
  const base = ud._fingerBase || (ud._fingerBase = new Map());
  const live = xrFingerCurl();
  for (const side of ['left', 'right']) {
    const sgn = side === 'left' ? -1 : 1;
    const cur = simCurl[side] ?? live[side];
    for (const [finger, key] of [['Index', 'index'], ['Middle', 'grip'], ['Ring', 'grip'], ['Little', 'grip']]) {
      const amt = Math.min(1, Math.max(0, cur[key] || 0));
      ['Proximal', 'Intermediate', 'Distal'].forEach((seg, i) => {
        const b = h.getNormalizedBoneNode(side + finger + seg); if (!b) return;
        let b0 = base.get(b); if (!b0) { b0 = b.quaternion.clone(); base.set(b, b0); }
        curlQ.setFromEuler(curlE.set(0, 0, sgn * CURL[i] * amt));
        b.quaternion.copy(b0).multiply(curlQ);
      });
    }
  }
}

export function tickXRBody(dt) {
  dbg.ticks++;
  // ?xrsim with a fed head pose runs the chain WITHOUT a session: the headless
  // fake session lives ~1 frame/2 s and drops unpredictably; the math and the
  // frame ordering are what this path tests (the session itself is proven apart)
  if (!isPresenting() && !simHead) { dbg.notPresenting++; return; }
  const av = getSelf(); const vrm = av?.vrm; const h = vrm?.humanoid;
  if (!h || !av.root) { dbg.noSelf++; return; }
  dbg.ran++;
  const rig = xrRig();

  // the HMD in world, then scaled about the rig (DeviceScale: tracked targets, not the view)
  if (simHead) { hmdPos.fromArray(simHead.pos); hmdQ.fromArray(simHead.quat); }
  else renderer.xr.getCamera().matrixWorld.decompose(hmdPos, hmdQ, tmpS);
  const k = xrScale().k;
  if (k !== 1) hmdPos.sub(rig.position).multiplyScalar(k).add(rig.position);

  // 1. distributed look-at
  // facing = the body's TRUE world yaw. The controller already turns the body to
  // the HMD's yaw every frame (setCamYaw → myState.yaw → root.rotation.y), so the
  // residual here is only what the head has turned beyond the body. R's first
  // headset read (09-05 19:55): computing this against rig.rotation.y (0 at
  // entry) while the body faced her heading gave a constant residual ≈ her
  // heading — the spine twisted toward it, the anchor pulled, the controller
  // re-asserted: 'snap back' and 'the back of my avatar'.
  av.root.getWorldQuaternion(qYaw); eul.setFromQuaternion(qYaw, 'YXZ');
  const facing = eul.y + (vrm.meta?.metaVersion === '0' ? Math.PI : 0);
  qYaw.setFromEuler(eul.set(0, facing, 0, 'YXZ')).invert();
  qRel.copy(qYaw).multiply(hmdQ);   // porch's Ry(π) flip is already carried by `facing` (VRM0 rest faces +Z); probe 09-05: with both, residual yaw read π and pitch vanished
  eul.setFromQuaternion(qRel, 'YXZ');
  const pitch = THREE.MathUtils.clamp(eul.x, -0.7, 0.7), roll = THREE.MathUtils.clamp(eul.z, -0.5, 0.5), yaw = sa(eul.y);
  dbg.sim = !!simHead; dbg.hmdQ = hmdQ.toArray().map((v) => +v.toFixed(3)); dbg.pitchRaw = +pitch.toFixed(3);
  // dt is 0 after a >2 s hitch (frame.js clamps it) — headless XR runs at ~0.5 fps and
  // every frame is one; a zero step would freeze the chain, so take a half step instead
  const s = dt > 0 ? Math.min(1, dt * 9) : 0.5;
  look.x += (pitch - look.x) * s; look.y += (yaw - look.y) * s; look.z += (roll - look.z) * s;
  const yawFade = Math.max(0, Math.cos(look.x));
  const bones = CHAIN.map((n) => h.getNormalizedBoneNode(n));
  let sY = 0, sP = 0, sR = 0; bones.forEach((b, i) => { if (b) { sY += wY[i]; sP += wP[i]; sR += wR[i]; } });
  bones.forEach((b, i) => { if (!b) return; b.quaternion.setFromEuler(eul.set(look.x * (wP[i] / sP), look.y * (wY[i] / sY) * yawFade, look.z * (wR[i] / sR), 'YXZ')); });

  // 2. eye anchor — measured eye if the VRM has eye bones, else head + (0, .06, .10)
  vrm.scene.position.set(0, 0, 0); vrm.scene.updateMatrixWorld(true);
  const le = h.getNormalizedBoneNode('leftEye'), re = h.getNormalizedBoneNode('rightEye'), hd = h.getNormalizedBoneNode('head');
  if (le && re) eyeW.copy(le.getWorldPosition(v1)).add(re.getWorldPosition(tmpS)).multiplyScalar(0.5);
  else if (hd) eyeW.copy(hd.getWorldPosition(v1)).add(tmpS.set(0, 0.06, 0.10).applyQuaternion(hd.getWorldQuaternion(rigQ)));
  else return;
  delta.copy(hmdPos).sub(eyeW);
  av.root.getWorldQuaternion(rigQ).invert();          // root-local: the controller owns the root; we offset the VRM inside it
  vrm.scene.position.copy(delta.applyQuaternion(rigQ));
  vrm.scene.updateMatrixWorld(true);

  // 3. arms to the grips (A3) — emotes trump IK (R's rule: an emote you chose
  // always wins); an untracked grip (sitting at the rig origin) leaves the arm
  // to the clip. Targets are DeviceScaled about the rig like the head.
  if (av.emote) { dbg.arms.left = dbg.arms.right = false; return; }
  const hands = xrHands();
  for (const side of ['left', 'right']) {
    const grip = hands[side]?.grip;
    let ok = false;
    if (simGrip[side]) { gripP.fromArray(simGrip[side].pos); gripQ.fromArray(simGrip[side].quat); ok = solveArm(vrm, side, gripP, gripQ); }
    else if (grip) {
      grip.matrixWorld.decompose(gripP, gripQ, tmpS);
      if (gripP.distanceToSquared(rig.position) > 1e-4) {
        if (k !== 1) gripP.sub(rig.position).multiplyScalar(k).add(rig.position);
        ok = solveArm(vrm, side, gripP, gripQ);
      }
    }
    dbg.arms[side] = ok;
  }
  fingerTick(vrm);   // after the arms: curls compose onto the solved pose
}
