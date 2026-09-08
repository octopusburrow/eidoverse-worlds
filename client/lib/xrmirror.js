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
import { tee } from './base.js';

const deskCam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 20000);
const tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), behind = new THREE.Vector3();
let lastAspect = 0;

// R 09-08 00:47: the scene re-render (porch-old's pattern, above) costs a full pass on top of stereo — on this
// renderer that is a MISSED FRAME every tick (the SteamVR construct fading up at head angles) and the input
// pass starved with it. 'first' now re-renders NOTHING: the eye buffer is the session's XRWebGLLayer — an opaque
// framebuffer, not a texture three can sample, but a legal READ framebuffer for gl.blitFramebuffer inside the
// animation frame (WebXR §opaque framebuffers). One GL call: the left eye onto the canvas. 'third' still needs a
// pass, into a SMALL target (fill is the lever), blitted up.
let thirdRT = null, blitFailed = false, blitTeed = false;
function blitEye() {
  const gl = renderer.backend?.gl; const layer = renderer.xr.getSession?.()?.renderState?.baseLayer ?? null;
  if (!gl || !layer?.framebuffer) return false;
  const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight, ew = layer.framebufferWidth >> 1, eh = layer.framebufferHeight;
  const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), prevDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  try {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // letterbox the eye's aspect into the canvas
    const s = Math.min(cw / ew, ch / eh); const dw = Math.round(ew * s), dh = Math.round(eh * s), dx = (cw - dw) >> 1, dy = (ch - dh) >> 1;
    gl.blitFramebuffer(0, 0, ew, eh, dx, dy, dx + dw, dy + dh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    return gl.getError() === gl.NO_ERROR;
  } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDraw); }
}
function blitRT(rt) {
  const gl = renderer.backend?.gl; const fbs = renderer.backend?.get?.(rt)?.framebuffers; const fb = fbs ? Object.values(fbs)[0] ?? null : null;   // keyed by render-context cache key; one context renders into it
  if (!gl || !fb) return false;
  const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
  const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), prevDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); gl.blitFramebuffer(0, 0, rt.width, rt.height, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.LINEAR); return gl.getError() === gl.NO_ERROR; }
  finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDraw); }
}

export function tickXRMirror() {
  if (!isPresenting() || xrPrefs.mirror === 'off') return;
  if (xrPrefs.mirror === 'first') {
    if (!blitFailed) { if (blitEye()) return; blitFailed = true; tee('[xr] mirror: eye blit unavailable — falling back to a scene pass'); }
  }
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
  // the pass renders into a SMALL target (a quarter of the canvas on each side — fill, not draws, is what the
  // frame budget can't afford), with the output target held on the canvas so a null target never resolves to
  // the eyes (three r185: XR sets outputRenderTarget = xrRenderTarget for the frame — R 09-08 00:38's double vision)
  const tw = Math.max(320, (renderer.domElement.width >> 1) || 640), th = Math.max(180, (renderer.domElement.height >> 1) || 360);
  if (!thirdRT || thirdRT.width !== tw || thirdRT.height !== th) { thirdRT?.dispose(); thirdRT = new THREE.RenderTarget(tw, th, { depthBuffer: true, samples: 0 }); }
  const was = renderer.xr.enabled; const oldRT = renderer.getRenderTarget(); const oldOut = renderer.getOutputRenderTarget?.() ?? null;
  renderer.xr.enabled = false;
  try {
    renderer.setOutputRenderTarget?.(null);
    renderer.setRenderTarget(thirdRT);
    // the desktop view sees the third-person head (layer 10), never the FP-only meshes (9)
    deskCam.layers.enable(10); deskCam.layers.disable(9);
    renderer.render(scene, deskCam);
    renderer.setRenderTarget(null);
    if (!blitRT(thirdRT) && !blitTeed) { blitTeed = true; tee('[xr] mirror: target blit unavailable — the small pass has nowhere to go'); }
  } catch { /* a bad frame must never kill the XR loop */ }
  finally {
    renderer.setOutputRenderTarget?.(oldOut); renderer.setRenderTarget(oldRT); renderer.xr.enabled = was;
    if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);   // the eyes rebuilt from the rig before the stereo pass (renderAside's rule)
  }
}
