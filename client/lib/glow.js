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

// an entity removed mid-glow must not pin its dead subtree in this registry
// (found in the 08-06 self-audit R demanded — keyed by root, the entry and
// its material outlived the entity)
bus.on('entity', ({ id, gone }) => { if (gone) glowRemove(id); });

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

export function glowRemove(id) {
  const g = active.get(id);
  if (!g) return;
  active.delete(id);
  for (const s of g.shells) s.parent?.remove(s);
  g.mat.dispose();
}
