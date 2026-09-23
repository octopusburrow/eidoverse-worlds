// XR PIXEL-RATIO GUARD (#32, the split vision: "3/4 left eye and 1/4 right eye, all in the left field").
//
// three r186's WebGL backend renders the scene into its tone-mapping/colour-space target
// (isPostProcessingRenderTarget) and multiplies EVERY EYE'S VIEWPORT by renderer.getPixelRatio()
// (three.webgpu.js: `pixelRatio = (renderTarget === null || renderTarget.isPostProcessingRenderTarget)
// ? this.renderer.getPixelRatio() : 1`, then `vp.x * pixelRatio`). XRManager pins the ratio to 1 at
// session start, but nothing stops a later setPixelRatio: CanvasTarget writes _pixelRatio BEFORE its
// "can't resize while presenting" check, and that check reads an `xr` the CanvasTarget doesn't have.
// Under load the frame governor shed pixels (1 → 0.75 on a desktop-monitor PC), so the right eye's
// viewport started at 0.75·W and painted over the last quarter of the left eye's half. Onset "after a
// minute, only in heavy worlds", survives exit/re-entry, cleared by reload: the governor's state.
//
// While presenting, the ratio belongs to the XR layer. Callers (governor, render-scale menu, diagnostics)
// are deferred, not refused: the last value asked for is handed back at exit via takeDeferred().
export function guardPixelRatioInXR(renderer) {
  if (!renderer || renderer.__xrPixelRatioGuard) return null;
  const apply = renderer.setPixelRatio.bind(renderer);
  let deferred = null;
  renderer.setPixelRatio = function setPixelRatio(value = 1) {
    if (renderer.xr?.isPresenting) { deferred = value; return; }
    apply(value);
  };
  const handle = {
    takeDeferred() { const v = deferred; deferred = null; return v; },
    get deferred() { return deferred; },
  };
  renderer.__xrPixelRatioGuard = handle;
  return handle;
}
