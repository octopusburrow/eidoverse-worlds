// The live world's render path, shared by animation and frame capture.
import { THREE, renderer, scene, camera } from './core.js';
import { CONFIG, bus } from './base.js';
import { DrawBatches } from './draw_batches.js';
import { warm, warmDepth, P_AMBIENT } from './warmqueue.js';

const batches = new DrawBatches({ warm: async (mesh, live) => {
  let error;
  await warm('instance pipelines', async () => {
    if (!live()) return;
    const culled = mesh.frustumCulled;
    mesh.frustumCulled = false;
    try { await renderer.compileAsync(mesh, camera, scene); }
    catch (e) { error = e; }
    finally { mesh.frustumCulled = culled; }
  }, { p: P_AMBIENT });
  if (error) throw error;
  if (mesh.castShadow && live()) await warmDepth('instance shadows', () => live() ? [mesh] : []);
} });
batches.enabled = CONFIG.params.get('batching') !== '0';
let lastRender = {};

/** Render something that is NOT the world's eye pass — a sky bake, a thumbnail, a snapshot, the
 *  desktop mirror — without disturbing WebXR. three's XRManager.updateCamera(cam) runs inside EVERY
 *  renderer.render() while presenting and rewrites the SHARED stereo camera from `cam.parent`; a
 *  parentless bake/thumbnail camera leaves the eyes at the playspace origin for the frame (R's Steam
 *  Frame, 2026-09-05 21:45–23:30: 'I pop to the origin' — per-eye cameras at (0, 1.6, 0) while the
 *  base camera sat on the rig; sky_baked.js:351 had met the same class once). Pattern from porch-old
 *  :11176–11179: XR off around the pass, render target saved and restored. */
export function renderAside(sc, cam, target = null) {
  const xr = renderer.xr;
  if (!xr?.isPresenting) { const rt = renderer.getRenderTarget(); renderer.setRenderTarget(target); try { return renderer.render(sc, cam); } finally { renderer.setRenderTarget(rt); } }
  const was = xr.enabled, rt = renderer.getRenderTarget();
  xr.enabled = false;
  try { renderer.setRenderTarget(target); return renderer.render(sc, cam); }
  finally { renderer.setRenderTarget(rt); xr.enabled = was; if (xr.cameraAutoUpdate) xr.updateCamera(camera); }   // the eyes are rebuilt from the RIG before anything else renders
}

export function renderWorld() {
  const before = { ...renderer.info.render };
  if (renderer.xr?.isPresenting && renderer.xr.cameraAutoUpdate) renderer.xr.updateCamera(camera);   // belt and braces: whatever rendered aside this frame, the eye pass starts from the rig
  batches.render(renderer, scene, camera);
  const after = renderer.info.render;
  // Count this render and its nested shadow/output passes, independently of
  // sky bakes or earlier captures in the same animation frame. Never reset the
  // renderer's shared counters: other diagnostics own their own intervals.
  lastRender = {
    drawCalls: after.drawCalls - before.drawCalls,
    triangles: after.triangles - before.triangles,
    points: after.points - before.points,
    lines: after.lines - before.lines,
    passes: after.calls - before.calls,
  };
}

/** On-demand inventory before batching, by source type and library. Material
 *  groups are not total GPU draws (shadows, transparency and output add passes);
 *  `render.drawCalls` above is the measured total. No per-frame survey cost. */
function sourceSurvey() {
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    camera.coordinateSystem, camera.reversedDepth);
  const types = new Map(), libraries = new Map();
  const visit = (o, lib = null) => {
    if (!o.visible) return;
    lib = o.userData.lib ?? lib;
    if ((o.isMesh || o.isSprite || o.isLine || o.isPoints) && o.layers.test(camera.layers)
      && (!o.isInstancedMesh || o.count > 0)
      && (!o.frustumCulled || (o.isSprite ? frustum.intersectsSprite(o,camera) : frustum.intersectsObject(o)))) {
      const groups = Array.isArray(o.material)
        ? o.geometry.groups.filter((g) => o.material[g.materialIndex]?.visible).length
        : o.material?.visible ? 1 : 0;
      if (groups) {
        const type = o.userData.drawBatchSource ? 'library' : o.isSkinnedMesh ? 'skinned'
          : o.isInstancedMesh ? 'instanced' : o.isSprite ? 'sprites' : o.isLine ? 'lines' : 'other';
        let row = types.get(type);
        if (!row) types.set(type, row = { type, visibleObjects: 0, materialGroups: 0 });
        row.visibleObjects++; row.materialGroups += groups;
        if (lib) libraries.set(lib, (libraries.get(lib) ?? 0) + groups);
      }
    }
    for (const child of o.children) visit(child,lib);
  };
  visit(scene);
  return { types: [...types.values()], libraries: [...libraries].map(([lib,materialGroups]) => ({lib,materialGroups}))
    .sort((a,b) => b.materialGroups-a.materialGroups).slice(0,20) };
}

export const drawStats = ({ sources = false } = {}) => ({ render: lastRender, batching: batches.debug(),
  ...(sources ? { sources: sourceSurvey() } : {}) });
export function setDrawBatching(on) {
  batches.enabled = !!on;
  if (!on) batches.dispose();
  return drawStats();
}
bus.on('world-reset', () => batches.dispose());
