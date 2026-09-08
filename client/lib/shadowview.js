// ?shadowview=1 — R 09-07 19:32: no ground shadow from any scene caster on her RTX 4080 (ANGLE/D3D11), while
// SwiftShader shows one; every state tee matches. So: put the SUN'S VIEW on screen. Each frame the scene is
// rendered from sun.shadow.camera with a depth-as-grey override into a small colour target (renderAside — XR-safe),
// and that target is drawn on a camera-locked quad, top-left. If the yucca's silhouette is there, the sun camera
// sees it (frustum + geometry are right) and the fault is in the shadow pass or the compare sampling; if not,
// the map's view is wrong. Diagnostic only; a no-op without the param.
import { THREE, TSL, scene, camera, sun } from './core.js';
import { CONFIG } from './base.js';
import { renderAside } from './render.js';

const ON = CONFIG.params.has('shadowview');
let rt = null, depthMat = null, quad = null;

function ensure() {
  if (rt) return;
  rt = new THREE.RenderTarget(512, 512, { depthBuffer: true });
  depthMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  // view-space depth from the light, near = white, far = black (150 m = the light camera's far window)
  depthMat.colorNode = TSL.vec3(TSL.positionView.z.negate().div(150).oneMinus().clamp(0, 1));
  quad = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicNodeMaterial({ map: rt.texture, depthTest: false, depthWrite: false }));
  quad.renderOrder = 10000; quad.frustumCulled = false; quad.position.set(-0.36, 0.22, -0.6);
  camera.add(quad);
}

export function tickShadowView() {
  if (!ON) return;
  ensure();
  const prev = scene.overrideMaterial; scene.overrideMaterial = depthMat;
  quad.visible = false;
  try { renderAside(scene, sun.shadow.camera, rt); }
  catch (e) { console.warn('[shadowview]', e?.message ?? e); }
  finally { scene.overrideMaterial = prev; quad.visible = true; }
}
