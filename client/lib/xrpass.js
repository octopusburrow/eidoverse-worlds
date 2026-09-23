// STEREO RENDERS GET THEIR OWN PASS (vr-exit-hang-commons: "why is entering and leaving VR such a heavy cost?").
//
// three r186 keeps one render object per (object, material, render context, lights) in a chain map chosen by
// passId. The XR stereo ArrayCamera changes a render object's dynamic cache key (`cameras.length`), so while desktop
// and XR shared the default map every switch disposed each object and rebuilt it in the same slot — entry threw
// the desktop variant away and the first exit recompiled every material in the world (61 programs for 60
// materials, measured: tools/xr-switch-compile-probe.mjs). Worse, a desktop-side pre-warm of the XR variant was
// undone by the very next desktop frame.
//
// Routing stereo cameras to their own chain map ('xr', 'xr:backSide') lets both variants live side by side:
// after each variant's first build, a switch is a presentation change, not a rebuild (Basis's soft swap).
// passId is only ever a map key in three (never compared), and compileAsync resolves through the same get(),
// so a warm with a stereo camera lands in the map the headset will read.
const isStereo = (camera) => camera?.isArrayCamera === true && camera.cameras.length > 0;

export function separateXRPass(renderer) {
  const objects = renderer?._objects;
  if (!objects || objects.__xrPass || typeof objects.get !== 'function') return false;
  const get = objects.get.bind(objects);
  objects.get = function (object, material, scene, camera, lightsNode, renderContext, clippingContext, passId) {
    // three's own rebuild re-enters get() with the passId it was given: prefix once
    if (isStereo(camera) && !(typeof passId === 'string' && passId.startsWith('xr'))) passId = passId ? `xr:${passId}` : 'xr';
    return get(object, material, scene, camera, lightsNode, renderContext, clippingContext, passId);
  };
  objects.__xrPass = true;
  return true;
}

/** A two-eye stand-in for renderer.xr.getCamera(), which has ZERO sub-cameras until the first XR frame (three pushes
 *  the eyes per frame) — a warm with it compiled the mono variant under a stereo name. Viewports and projections
 *  don't enter the shader; the eye count does. */
export function stereoStandIn(THREE, from) {
  const eye = (x) => {
    const c = from?.isPerspectiveCamera ? from.clone() : new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    c.viewport = new THREE.Vector4(x, 0, 1, 1);
    return c;
  };
  const cam = new THREE.ArrayCamera([eye(0), eye(1)]);
  if (from) { cam.position.copy(from.getWorldPosition(new THREE.Vector3())); cam.quaternion.copy(from.getWorldQuaternion(new THREE.Quaternion())); }
  cam.updateMatrixWorld(true);
  return cam;
}
