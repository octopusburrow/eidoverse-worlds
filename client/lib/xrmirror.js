// Desktop view while presenting (R, 09-05 18:22: "mirror VR view to desktop,
// and 3rd person as an option"). By default the desktop canvas goes black in
// VR — WebXR owns the framebuffer. This system draws one extra frame per tick
// onto the canvas from a desktop camera: 'first' = the headset's own eyes,
// 'third' = behind-and-above the body, looking at it. porch-old's pattern
// (index.html:11160–11184): renderer.xr.enabled OFF around the pass, then
// restored, so three renders to the canvas instead of the eye buffers.
import { THREE, renderer, scene, camera } from './core.js';
import { isPresenting, xrPrefs } from './xr.js';
import { myState } from './controller.js';

const deskCam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 20000);
const tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), behind = new THREE.Vector3();
let lastAspect = 0;

export function tickXRMirror() {
  if (!isPresenting() || xrPrefs.mirror === 'off') return;
  const w = renderer.domElement.clientWidth || 1, h = renderer.domElement.clientHeight || 1;
  if (w / h !== lastAspect) { lastAspect = w / h; deskCam.aspect = lastAspect; deskCam.updateProjectionMatrix(); }
  const xrCam = renderer.xr.getCamera();
  if (xrPrefs.mirror === 'first') {
    xrCam.matrixWorld.decompose(tmpPos, tmpQuat, behind);
    deskCam.position.copy(tmpPos); deskCam.quaternion.copy(tmpQuat);
  } else {
    // third person: 2.2 m behind the head's yaw, 0.8 m above the body, looking at chest height
    xrCam.matrixWorld.decompose(tmpPos, tmpQuat, behind);
    const yaw = Math.atan2(2 * (tmpQuat.w * tmpQuat.y + tmpQuat.x * tmpQuat.z), 1 - 2 * (tmpQuat.y * tmpQuat.y + tmpQuat.x * tmpQuat.x));
    behind.set(Math.sin(yaw) * 2.2, 0.8, Math.cos(yaw) * 2.2);
    deskCam.position.set(myState.pos.x + behind.x, myState.pos.y + 1.4 + behind.y, myState.pos.z + behind.z);
    deskCam.lookAt(myState.pos.x, myState.pos.y + 1.2, myState.pos.z);
  }
  deskCam.updateMatrixWorld(true);
  const was = renderer.xr.enabled;
  renderer.xr.enabled = false;
  try {
    // the desktop view sees the third-person head (layer 10), never the FP-only meshes (9)
    deskCam.layers.enable(10); deskCam.layers.disable(9);
    renderer.render(scene, deskCam);
  } catch { /* a bad frame must never kill the XR loop */ }
  finally { renderer.xr.enabled = was; }
}
