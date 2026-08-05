// xrpanels — the schema panels as PHYSICAL SURFACES (R, 21:58: "make sure
// they'll interop in VR — first thing I check"). Same schemas, same
// dispatchers as the desktop frames; here they're canvas-textured quads
// floating at desk height, and the right-hand laser is the cursor. No DOM
// crosses the threshold — panels.js renderCanvas paints the identical fields
// and hands back hit REGIONS a laser UV-hit resolves against.

import { THREE, bus } from './core.js';
import { renderCanvas, hitRegion } from './panels.js';
import { manifestFields, manifestDispatch } from './manifest.js';
import { inspectorFields, inspectorDispatch } from './inspector.js';

const PX_PER_M = 900;              // canvas pixels per world metre of quad
const W = 0.58;                    // quad width, metres — an arm's-length read

let panels = null;                 // [{mesh, canvas, tex, regions, fields, dispatch}]
const _rc = new THREE.Raycaster();
const _m = new THREE.Matrix4();

function makePanel(fields, dispatch, x, ry) {
  const canvas = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
  mesh.position.set(x, 1.15, -0.72);
  mesh.rotation.y = ry;
  mesh.userData.noCamCollide = true;
  const p = { mesh, canvas, tex, regions: [], fields, dispatch };
  repaint(p);
  return p;
}

function repaint(p) {
  p.regions = renderCanvas(p.canvas, p.fields(), { width: Math.round(W * PX_PER_M) });
  // quad keeps the canvas's aspect so buttons are where they look like they are
  p.mesh.scale.set(W, W * (p.canvas.height / p.canvas.width), 1);
  p.tex.needsUpdate = true;
}

let repaintQueued = false;
function repaintAll() {
  if (!panels || repaintQueued) return;
  repaintQueued = true;            // events arrive in bursts; one paint per frame
  requestAnimationFrame(() => {
    repaintQueued = false;
    if (panels) panels.forEach(repaint);
  });
}

export function xrPanelsEnter(rig) {
  panels = [
    makePanel(manifestFields, manifestDispatch, -0.42, 0.35),
    makePanel(inspectorFields, inspectorDispatch, 0.42, -0.35),
  ];
  for (const p of panels) rig.add(p.mesh);
  bus.on('entity', repaintAll);
  bus.on('comp', repaintAll);
  bus.on('selection', repaintAll);
}

export function xrPanelsExit(rig) {
  if (!panels) return;
  for (const p of panels) { rig.remove(p.mesh); p.tex.dispose(); p.mesh.geometry.dispose(); }
  panels = null;
}

/** Laser test against the panels. Returns hit distance (for laser length) or
 *  null. When `click`, resolves the region and fires the panel's dispatcher —
 *  the same function the desktop frame calls. */
export function xrPanelsPick(handRay, click = false) {
  if (!panels) return null;
  _m.identity().extractRotation(handRay.matrixWorld);
  _rc.ray.origin.setFromMatrixPosition(handRay.matrixWorld);
  _rc.ray.direction.set(0, 0, -1).applyMatrix4(_m);
  _rc.far = 3;
  const hit = _rc.intersectObjects(panels.map((p) => p.mesh), false)[0];
  if (!hit) return null;
  if (click && hit.uv) {
    const p = panels.find((q) => q.mesh === hit.object);
    const r = hitRegion(p.regions, p.canvas, hit.uv.x, 1 - hit.uv.y);
    if (r) { p.dispatch(r.action, r.payload); repaintAll(); }
  }
  return hit.distance;
}
