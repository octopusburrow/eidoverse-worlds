// VR quads = the REAL desktop frames (R, 2026-09-05 20:37: "use the ACTUAL menus so
// there is only one set of panels to maintain"). Each XR-registered frame's live DOM is
// rasterised onto a quad by the vendored HTMLMesh (vendor/htmlmesh.js: DPR, inline SVG,
// throttle, no window dispatch) and a trigger on the quad fires the SAME click/input
// handlers the mouse does — one panel set, one code path. While presenting, the frame
// element is moved into an offscreen-but-laid-out stage (HTMLMesh measures with
// getBoundingClientRect, never elementFromPoint, so negative coordinates are fine) and
// returned, with its display state, on exit. Fallback for comparison: ?canvasquads=1.
import { THREE } from './core.js';
import { bus } from './base.js';
import { allFrames, getFrame } from './frames.js';
import { HTMLMesh } from './vendor/htmlmesh.js';

const PX_PER_M = 900;      // xrpanels' density — the number R's eyes accepted
const W = 0.58;            // metres across, like the canvas quads
const XR_FRAMES = ['world', 'emotes', 'settings', 'chat', 'debug', 'profile'];   // the frames that had canvas quads
const LIVE_MIN_MS = { debug: 250, chat: 250 };   // live panels re-rasterise at most 4 Hz; others at 16 ms

let stage = null; let quads = null; let shown = false;
const _rc = new THREE.Raycaster(); const _m = new THREE.Matrix4();

function ensureStage() {
  if (stage) return stage;
  // XR-only chrome for the staged frames: HTMLMesh's mini-renderer has no blur/shadow, so the head
  // strip gets a solid token blend; desktop-only furniture (✕, resize, collapse) is hidden on the quad
  const css = document.createElement('style'); css.id = 'xr-stage-css';
  css.textContent = `#xr-stage .frame.panel { box-shadow: none; backdrop-filter: none; background: color-mix(in srgb, var(--panel) 92%, black); }
#xr-stage .fr-head { background: color-mix(in srgb, var(--panel) 70%, black); backdrop-filter: none; }
#xr-stage .fr-btns { display: none; }`;
  document.head.appendChild(css);
  stage = document.createElement('div'); stage.id = 'xr-stage';
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:visible;visibility:visible;pointer-events:none;';
  document.body.appendChild(stage);
  return stage;
}

function mount(api, i, n) {
  const el = api.el;
  const restore = { parent: el.parentNode, next: el.nextSibling, display: el.style.display, left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, position: el.style.position, collapsed: el.classList.contains('collapsed') };
  ensureStage().appendChild(el);
  el.style.display = 'flex'; el.style.left = '0px'; el.style.top = '0px'; el.style.position = 'absolute';   // laid out, visible, INSIDE the offscreen stage (frames are position:fixed — left at that they piled up in the desktop's corner while presenting; R 22:25)
  el.classList.remove('collapsed');
  if (el.offsetWidth < 40 || el.offsetHeight < 40) {   // a frame that has never been shown may carry no size yet
    const st = api._state ?? api.state ?? {}; el.style.width = `${st.w ?? 300}px`; el.style.height = `${st.h ?? 220}px`;
  }
  const cssW = Math.max(40, el.offsetWidth);
  const scale = (PX_PER_M * W) / cssW;   // device px per CSS px so the quad reads at 900 px/m
  const mesh = new HTMLMesh(el, { scale, minInterval: LIVE_MIN_MS[api.id] ?? 16 });
  mesh.material.transparent = false;
  const k = W / (cssW * 0.001);   // HTMLMesh geometry = CSS px × 1 mm; rescale to W metres
  mesh.scale.setScalar(k);
  const a = (i - (n - 1) / 2) * 0.55;
  mesh.position.set(Math.sin(a) * 0.85, 1.15, -Math.cos(a) * 0.85);
  mesh.rotation.y = -a;
  mesh.userData.noCamCollide = true;
  return { id: api.id, api, el, mesh, restore };
}

function unmount(q) {
  q.mesh.material.map?.dispose?.(); q.mesh.geometry.dispose(); q.mesh.material.dispose();
  const r = q.restore;
  // the desktop DOM may have re-ordered while we were presenting: the saved sibling is only usable if it is
  // still that parent's child (R, 09-05 22:20: 'error when I try to leave VR' — insertBefore NotFoundError)
  const parent = r.parent ?? document.body;
  if (r.next && r.next.parentNode === parent) parent.insertBefore(q.el, r.next); else parent.appendChild(q.el);
  q.el.style.display = r.display; q.el.style.left = r.left; q.el.style.top = r.top; q.el.style.width = r.width; q.el.style.height = r.height; q.el.style.position = r.position; if (r.collapsed) q.el.classList.add('collapsed');
}

export const domQuadsEnabled = () => !new URLSearchParams(location.search).has('canvasquads');

export function domQuadsEnter(rig) {
  const apis = XR_FRAMES.map((id) => getFrame(id)).filter(Boolean);
  const extra = allFrames().filter((f) => f.xr && !apis.includes(f));
  const list = [...apis, ...extra];
  quads = list.map((api, i) => mount(api, i, list.length));
  for (const q of quads) rig.add(q.mesh);
  shown = true;
  bus.emit('xr:domquads', quads.map((q) => q.id));
}

export function domQuadsExit(rig) {
  if (!quads) return;
  for (const q of quads) { rig.remove(q.mesh); try { unmount(q); } catch (e) { console.warn('[domquad] unmount', q.id, e); } }   // one bad restore must not strand the others (or the session teardown)
  quads = null; shown = false;
}

export function domQuadsSetShown(v) {
  shown = !!v;
  for (const q of quads ?? []) { q.mesh.visible = shown; const t = q.mesh.material.map; if (shown) t.resume?.(); else t.pause?.(); }
}

// mirrors xrPanelsPick: distance to the quad under the ray, or null; on click, the
// trigger becomes mousedown → mouseup → click at the hit uv on the real DOM
export function domQuadsPick(handRay, click = false) {
  if (!quads || !shown) return null;
  _m.identity().extractRotation(handRay.matrixWorld);
  _rc.ray.origin.setFromMatrixPosition(handRay.matrixWorld);
  _rc.ray.direction.set(0, 0, -1).applyMatrix4(_m);
  _rc.far = 3;
  const hit = _rc.intersectObjects(quads.map((q) => q.mesh), false)[0];
  if (!hit) return null;
  if (click && hit.uv) {
    const data = { x: hit.uv.x, y: 1 - hit.uv.y };
    for (const type of ['mousedown', 'mouseup', 'click']) hit.object.dispatchEvent({ type, data });
  }
  return hit.distance;
}

// one quad by id — a ring slot opens that frame's quad; `on` null toggles
export function domQuadShow(id, on = null) {
  const q = quads?.find((x) => x.id === id); if (!q) return false;
  q.mesh.visible = on == null ? !q.mesh.visible : !!on;
  const t = q.mesh.material.map; if (q.mesh.visible) t.resume?.(); else t.pause?.();
  shown = quads.some((x) => x.mesh.visible);
  return q.mesh.visible;
}
export const domQuadIds = () => (quads ?? []).map((q) => q.id);
export const domQuadTexture = (id) => quads?.find((q) => q.id === id)?.mesh.material.map ?? null;
