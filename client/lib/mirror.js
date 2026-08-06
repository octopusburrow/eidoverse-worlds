// mirror — a real reflective surface as a COMPONENT, so any entity can carry
// one (`mirror` in its comp bag). Ported from porch-old's framed Reflector with
// its scars intact, rebuilt on the WebGPU path: TSL reflector() node instead of
// the WebGL-only addon.
//
// Lessons that rode over from the porch (2026-07-09..15, measured then):
// - a mirror is a DEBUGGING INSTRUMENT first — you can't check your own
//   avatar's face/hands/feet without one, so it must show your self-body even
//   while first-person mode hides it (counter-reveal during the capture pass).
// - resolution matters: floor it high enough to read a face in the glass.
//
// Comp data (all optional): { w, h, resolutionScale } — plane is w×h metres,
// bottom edge on the entity origin, facing entity +Z.

import { THREE, bus } from './core.js';
import { reflector } from 'three/tsl';
import { registerComponent } from './components.js';
import { entities, comps } from './world.js';

const FP_LAYER = 9, TP_LAYER = 10;   // three-vrm firstPerson split (xr.js)

let getSelf = () => null;
export const bindMirrorSelf = (fn) => { getSelf = fn; };

const active = new Map();   // entity id -> { group, dispose }

function attach(id, data = {}) {
  detach(id);
  const root = entities.get(id);
  if (!root) return;                       // not loaded yet; entity event retries
  const w = +data.w || 1.2, h = +data.h || 2.1;

  // bounces stays TRUE: with false the node's update drops to FRAME stage and
  // the capture never runs under our renderer (glass renders black, measured
  // 08-06). Half-res RT is the perf lever instead; raise per-mirror via
  // resolutionScale when a shot needs it.
  const refl = reflector({ resolutionScale: +data.resolutionScale || 0.5 });
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = refl;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  glass.add(refl.target);

  // CAPTURE-PASS HOOK, both halves of the self-visibility problem:
  // - desktop FP hides the whole vrm.scene (controller.js) → reveal it for the
  //   duration of the reflection render (porch-old's onBeforeRender trick,
  //   relocated to the node's updateBefore since TSL owns the render now).
  // - XR FP splits meshes onto layers 9/10 and the eye cameras see 9 — the
  //   virtual camera is cloned ONCE from the live camera (three r184) so it
  //   inherits whatever mask it was cloned under. Force it every capture:
  //   live mask + third-person layer (full-headed body), minus the headless
  //   first-person half.
  const base = refl._reflectorBaseNode;
  const origUpdate = base.updateBefore.bind(base);
  base.updateBefore = (frame) => {
    const me = getSelf();
    const wasVisible = me?.vrm ? me.vrm.scene.visible : null;
    if (me?.vrm) me.vrm.scene.visible = true;
    const vc = base.getVirtualCamera(frame.camera);
    vc.layers.mask = frame.camera.layers.mask;
    vc.layers.enable(TP_LAYER);
    vc.layers.disable(FP_LAYER);
    const out = origUpdate(frame);
    if (wasVisible !== null) me.vrm.scene.visible = wasVisible;
    return out;
  };

  // low-poly frame so the glass is findable from the side
  const group = new THREE.Group();
  glass.position.y = h / 2;
  group.add(glass);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x24201a, roughness: 0.8, metalness: 0.15 });
  const beam = (bw, bh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.07), beamMat);
    m.position.set(x, y + h / 2, -0.02);
    m.castShadow = true;
    return m;
  };
  group.add(beam(w + 0.16, 0.09, 0, h / 2 + 0.04));
  group.add(beam(w + 0.16, 0.09, 0, -h / 2 - 0.04));
  group.add(beam(0.09, h + 0.16, -w / 2 - 0.04, 0));
  group.add(beam(0.09, h + 0.16, w / 2 + 0.04, 0));

  root.add(group);
  active.set(id, {
    group,
    dispose() {
      base.updateBefore = origUpdate;      // unhook before the node is orphaned
      refl.dispose?.();
      group.parent?.remove(group);
      glass.geometry.dispose(); mat.dispose(); beamMat.dispose();
    },
  });
}

function detach(id) {
  const a = active.get(id);
  if (!a) return;
  active.delete(id);
  a.dispose();
}

export function initMirror() {
  registerComponent('mirror', {
    hint: 'reflective surface, w × h metres, faces +Z',
    defaults: { w: 1.2, h: 2.1 },
  });
  bus.on('comp', ({ id, type, data }) => {
    if (type !== 'mirror') return;
    if (data) attach(id, data); else detach(id);
  });
  bus.on('entity', ({ id, gone }) => {
    if (gone) { detach(id); return; }
    // late mesh arrival: the comp may land before the entity is buildable
    if (!active.has(id) && comps.get(id)?.mirror) attach(id, comps.get(id).mirror);
  });
}
