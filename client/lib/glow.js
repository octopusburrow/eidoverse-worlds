// glow — transient highlight shells for shared-material instances.
//
// The lesson (R, 08-06, after the crates blushed in unison): GLB-cache clones
// SHARE materials — that's what makes them instances, and it must stay true.
// Mutating a shared emissive warms every sibling; cloning the material breaks
// the instancing. So the highlight never touches the asset at all: each mesh
// gets a SHELL — same geometry BY REFERENCE (zero copies), slightly scaled,
// one additive material per active glow. Attention is presentation; the shell
// is removed when it cools, leaving the instance exactly as authored.

import { THREE, bus } from './core.js';

const active = new Map();   // entity id -> { root, shells: Mesh[], mat }

// an entity removed mid-glow must not pin its dead subtree in this registry.
// SECOND fix (same hour): the first listener tested `{gone}` — a field this
// bus NEVER emits (world.js says `kind: 'remove'`) — so the cleanup was dead
// code and the audit that "proved" it was watching shells leave with the
// removed subtree while the registry leaked anyway. antra caught the exact
// same phantom field in ambient.js on #26. A listener you haven't seen FIRE
// is not a cleanup path.
bus.on('entity', ({ id, kind }) => { if (kind === 'remove') glowRemove(id); });

export function glowSet(id, root, color, heat) {
  if (!root) return;
  if (heat <= 0.01) { glowRemove(id); return; }
  let g = active.get(id);
  if (!g) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.FrontSide,
    });
    const shells = [];
    root.traverse((o) => {
      if (!o.isMesh || o.userData.glowShell) return;
      // a static shell of a SkinnedMesh's geometry renders the BIND POSE — a
      // T-posed ghost jutting out of an animated body. Skinned things carry
      // their highlight elsewhere (or not at all) rather than wrongly.
      if (o.isSkinnedMesh) return;
      const shell = new THREE.Mesh(o.geometry, mat);   // geometry by reference
      shell.userData.glowShell = true;
      shell.raycast = () => {};                        // never pickable
      shell.scale.setScalar(1.015);
      shell.renderOrder = 8;
      o.add(shell);
      shells.push(shell);
    });
    g = { root, shells, mat };
    active.set(id, g);
  }
  g.mat.color.set(color);
  // 0.35 read as hot-pink shrink-wrap at close range (measured 08-06) —
  // attention should murmur, not shout
  g.mat.opacity = Math.min(1, heat) * 0.13;
}

/** the registry itself, inspectable — an audit that watches the SCENE can be
 *  fooled by shells leaving with a removed subtree (learned 08-06) */
export const glowDebug = () => [...active.keys()];

export function glowRemove(id) {
  const g = active.get(id);
  if (!g) return;
  active.delete(id);
  for (const s of g.shells) s.parent?.remove(s);
  g.mat.dispose();
}
