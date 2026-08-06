// feetik — planted feet for standing bodies, ported from porch-old's GAIT v1
// (2026-07-09, sign conventions locked by world-space tests there).
//
// The problem it solves here (R, 2026-08-06): the look chain turns a standing
// body toward your view past a threshold — without this, the body-yaw ease
// SKATES both feet through the floor. With it, feet are PLANTED in the world
// and STEP when their desired spot drifts too far or the body twists past
// ~40°: a step lifts on a sine arc over 0.28s, retargets mid-flight, and a
// foot won't step while its partner is airborne (that alternation is what
// reads as an actual weight shift).
//
// Runs ONLY while the mixer plays 'idle' — walk/run keep the clip's legs, and
// seated/lying/limp bodies keep their poses. Composes on the normalized bones
// AFTER the mixer (same slot as the look chain), so vrm.update() carries it.

import { THREE } from './core.js';

const GAIT = { STEP: 0.16, EMERG: 0.42, YAWT: 0.7, DUR: 0.28, LIFT: 0.055, LEAD: 0.15, LEADMAX: 0.35, SNAP: 1.5 };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _sa = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Aim `bone` so its child (rest offset childRestLocal) points at targetWorld. */
function aimBone(bone, targetWorld, childRestLocal) {
  const p = bone.getWorldPosition(_v1);
  const want = _v2.subVectors(targetWorld, p).normalize();
  const pq = bone.parent.getWorldQuaternion(_q1);
  const local = _v3.copy(want).applyQuaternion(_q2.copy(pq).invert());
  bone.quaternion.setFromUnitVectors(childRestLocal.clone().normalize(), local);
}

/** Two-bone leg solve: foot lands at targetPos, knee poled forward, foot flat
 *  with toes along footYaw. Normalized-space property: every bone's rest world
 *  rotation is identity, so a pure-yaw world quat = a flat foot. */
function solveLeg(vrm, side, targetPos, footYaw) {
  const h = vrm.humanoid;
  const U = h.getNormalizedBoneNode(side + 'UpperLeg');
  const L = h.getNormalizedBoneNode(side + 'LowerLeg');
  const F = h.getNormalizedBoneNode(side + 'Foot');
  if (!U || !L || !F) return;
  U.quaternion.identity(); L.quaternion.identity(); F.quaternion.identity();
  vrm.scene.updateMatrixWorld(true);
  const uPos = U.getWorldPosition(new THREE.Vector3());
  const l1 = L.position.length(), l2 = F.position.length();
  const uDir = L.position.clone(), lDir = F.position.clone();
  const toT = new THREE.Vector3().subVectors(targetPos, uPos);
  let d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.01);
  const K = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
  const Kc = THREE.MathUtils.clamp(K, 25 * Math.PI / 180, 178 * Math.PI / 180);   // no hyperextension snap
  if (Kc !== K) d = Math.sqrt(Math.max(1e-6, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(Kc)));
  const dir = toT.clone().normalize();
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const hips = h.getNormalizedBoneNode('hips');
  const hipsQ = hips ? hips.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  const pole = new THREE.Vector3(0, -0.15, 1).normalize().applyQuaternion(hipsQ);  // knees forward-and-down
  let axis = new THREE.Vector3().crossVectors(dir, pole);
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0); else axis.normalize();
  const upperDir = dir.clone().applyAxisAngle(axis, a);
  const knee = uPos.clone().addScaledVector(upperDir, l1);
  aimBone(U, knee, uDir); vrm.scene.updateMatrixWorld(true);
  aimBone(L, targetPos, lDir); vrm.scene.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(Math.sin(footYaw), 0, Math.cos(footYaw));
  const pQi = F.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, footYaw, 0));
  F.quaternion.copy(pQi.multiply(yawQ));   // flat foot, toes along the planted yaw
}

/** Desired plant spots: under the hips at rest hip-width, on the ground. */
function footTargets(vrm, groundY, meas) {
  const h = vrm.humanoid, hips = h.getNormalizedBoneNode('hips');
  if (!hips) return null;
  const hp = hips.getWorldPosition(_v1);
  const hq = hips.getWorldQuaternion(_q1);
  const fwd = _v2.set(0, 0, 1).applyQuaternion(hq); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); else fwd.normalize();
  const left = _v3.set(fwd.z, 0, -fwd.x);          // +x is the model's left at rest (porch sign test)
  const y = groundY + meas.ankleH;
  return {
    left: new THREE.Vector3(hp.x + left.x * meas.hipHalfW, y, hp.z + left.z * meas.hipHalfW),
    right: new THREE.Vector3(hp.x - left.x * meas.hipHalfW, y, hp.z - left.z * meas.hipHalfW),
    yaw: Math.atan2(fwd.x, fwd.z),
  };
}

function gaitLead(des, vel) {
  const l = vel.clone().multiplyScalar(GAIT.LEAD);
  if (l.length() > GAIT.LEADMAX) l.setLength(GAIT.LEADMAX);
  l.y = 0; return des.clone().add(l);
}

function gaitTick(g, desL, desR, bodyYaw, t, dt) {
  const mid = desL.clone().add(desR).multiplyScalar(0.5);
  if (g.lastMid) g.vel.copy(mid).sub(g.lastMid).divideScalar(Math.max(dt, 1e-4));
  if (!g.lastMid) g.lastMid = new THREE.Vector3();
  g.lastMid.copy(mid);
  const D = { L: desL, R: desR };
  for (const s of ['L', 'R']) {
    const f = g[s], o = g[s === 'L' ? 'R' : 'L'], des = D[s];
    if (f.step) {
      const p = (t - f.step.t0) / f.step.dur;
      if (p >= 1) { f.p.copy(f.step.to); f.yaw = f.step.toYaw; f.step = null; }
      else { if (p < 0.5) f.step.to.copy(gaitLead(des, g.vel)); continue; }
    }
    const err = Math.hypot(f.p.x - des.x, f.p.z - des.z);
    if (err > GAIT.SNAP) { f.p.copy(des); f.yaw = bodyYaw; continue; }  // teleport: re-plant, no glide
    const yerr = Math.abs(_sa(bodyYaw - f.yaw));
    if ((err > GAIT.STEP || yerr > GAIT.YAWT) && (!o.step || err > GAIT.EMERG)) {
      f.step = { from: f.p.clone(), fromYaw: f.yaw, to: gaitLead(des, g.vel), toYaw: bodyYaw, t0: t, dur: GAIT.DUR };
    }
  }
  const out = {};
  for (const s of ['L', 'R']) {
    const f = g[s];
    if (f.step) {
      const p = Math.min(1, (t - f.step.t0) / f.step.dur), e = p * p * (3 - 2 * p);
      const dy = _sa(f.step.toYaw - f.step.fromYaw);
      out[s] = { pos: f.step.from.clone().lerp(f.step.to, e), yaw: f.step.fromYaw + dy * e, lift: GAIT.LIFT * Math.sin(Math.PI * p) };
    } else out[s] = { pos: f.p.clone(), yaw: f.yaw, lift: 0 };
  }
  return out;
}

/** One avatar's planted-feet state; call update() every frame after the mixer.
 *  Engages only while `standing` (idle clip) — first standing frame plants
 *  both feet at their desired spots, leaving disengages cleanly. */
export class FeetIK {
  constructor(vrm) {
    this.vrm = vrm;
    this.g = null;
    // leg rest measurements: ankle height above model floor + hip half-width,
    // read from the neutral rest skeleton (bones identity ≈ how avatar.js
    // measures ragdoll limits).
    const h = vrm.humanoid;
    let ankleH = 0.09, hipHalfW = 0.09;
    try {
      const F = h.getNormalizedBoneNode('leftFoot'), U = h.getNormalizedBoneNode('leftUpperLeg');
      if (F && U) {
        const fy = F.getWorldPosition(new THREE.Vector3()).y;
        const ry = vrm.scene.getWorldPosition(new THREE.Vector3()).y;
        ankleH = Math.max(0.03, fy - ry);
        hipHalfW = Math.max(0.04, Math.abs(U.getWorldPosition(new THREE.Vector3()).x - vrm.scene.getWorldPosition(new THREE.Vector3()).x));
      }
    } catch { /* estimates hold */ }
    this.meas = { ankleH, hipHalfW };
  }

  update(standing, groundY, bodyYaw, dt, now) {
    if (!standing) { this.g = null; return; }
    const des = footTargets(this.vrm, groundY, this.meas);
    if (!des) return;
    if (!this.g) {
      this.g = {
        L: { p: des.left.clone(), yaw: des.yaw, step: null },
        R: { p: des.right.clone(), yaw: des.yaw, step: null },
        vel: new THREE.Vector3(), lastMid: null,
      };
    }
    const t = now / 1000;
    const out = gaitTick(this.g, des.left, des.right, des.yaw, t, dt);
    for (const [s, side] of [['L', 'left'], ['R', 'right']]) {
      const o = out[s];
      // fresh vector: solveLeg/aimBone chew through the shared scratch pool
      solveLeg(this.vrm, side, new THREE.Vector3(o.pos.x, o.pos.y + o.lift, o.pos.z), o.yaw);
    }
  }
}
