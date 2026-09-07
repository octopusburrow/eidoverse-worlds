// ?glass=1 — a standing mirror 2.2 m in front of where you arrive, facing you (R 09-06 23:37:
// 'make me a mirror real quick to make sure the heads look normal in VR'). three's TSL reflector
// (works on both backends; the classic Reflector addon is WebGL-only). The reflection pass lifts the
// first-person head chop so the glass shows the whole head — porch-old's pattern. Known limit: the
// reflector has no per-eye path, so in VR both eyes see one reflection from the head's position.
import * as THREE from 'three';
import { reflector } from 'three/tsl';
import { scene, camera } from './core.js';
import { bus, tee } from './base.js';
import { withHeadShown } from './xr.js';
import { myState } from './controller.js';

export function initGlass() {
  const W = 1.4, H = 2.2;
  const refl = reflector({ resolution: 0.5 });
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = refl.mul(0.92);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  glass.add(refl.target);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, H + 0.08, 0.04), new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.6 }));
  frame.position.z = -0.025;
  glass.add(frame);
  const base = refl.reflector, orig = base.updateBefore.bind(base);
  base.updateBefore = (f) => withHeadShown(() => orig(f));
  const place = () => {
    const dir = camera.getWorldDirection(new THREE.Vector3()); dir.y = 0; dir.normalize();
    glass.position.set(myState.pos.x + dir.x * 2.2, myState.pos.y + H / 2, myState.pos.z + dir.z * 2.2);
    glass.lookAt(myState.pos.x, myState.pos.y + H / 2, myState.pos.z);
    scene.add(glass);
    tee(`[glass] mirror at ${glass.position.x.toFixed(1)},${glass.position.z.toFixed(1)}`);
  };
  bus.on('booted', () => setTimeout(place, 800));
  return glass;
}
