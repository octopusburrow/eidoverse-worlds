// foliage — alpha-blended, textured leaves drawn as TWO passes in 'fast' mode (Video › foliage).
//
// A blended leaf writes no depth, so every layer of a canopy is shaded in full: EW.overdraw measured the Commons'
// two date palms at 41% of the frame facing them, 2.95 layers per covered pixel, 17+ at the crown (2026-09-24).
// fast = the classic foliage split: a CUTOUT twin of the mesh (alphaTest 0.999, writes depth, no blending) draws the
// solid interior of each leaf in the opaque pass, then the original blend draws after it with depthFunc Less, so it
// only fills what the cutout left — the soft edges — and everything hidden behind a solid leaf is rejected by depth.
// Measured on the palms: 1.65 layers/px (−45%, frame −25%) for 0.36% of pixels changed; R, 09-24: "very close …
// some jagged pixels in the center mass". 0.999 (not 0.98) halved those speckles; pure cutout buys no more fill.
// soft = the original single blended pass. auto = fast while presenting in a headset, soft on the desktop.
//
// Who qualifies: world models (prepareObject kind 'model'), not skinned, one material, transparent, textured, opacity
// ≥ 0.99 — foliage keeps its see-through in the TEXTURE; glass and tinted panels (uniform opacity) are left alone.
import { THREE, renderer, scene, camera } from './core.js';
import { warm, P_AMBIENT } from './warmqueue.js';

export const FOLIAGE_MODES = ['auto', 'soft', 'fast'];
const KEY = 'ew-foliage';
const CORE_ALPHA = 0.999;
const lsGet = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

let mode = FOLIAGE_MODES.includes(lsGet()) ? lsGet() : 'auto';
const entries = new Set();          // { o, m, depthFunc, core }
const noRaycast = () => {};

export const getFoliageMode = () => mode;
/** What auto resolves to right now. */
export const foliageEffective = () => (mode === 'auto' ? (renderer.xr?.isPresenting ? 'fast' : 'soft') : mode);

export function qualifiesAsFoliage(o) {
  if (!o?.isMesh || o.isSkinnedMesh || Array.isArray(o.material)) return false;
  const m = o.material;
  return !!(m?.isNodeMaterial && m.transparent && m.map && (m.opacity ?? 1) >= 0.99);
}

function makeCore(e) {
  const cut = e.m.clone();
  cut.transparent = false; cut.alphaTest = CORE_ALPHA; cut.depthWrite = true;
  const c = new THREE.Mesh(e.o.geometry, cut);
  c.name = 'foliage-core'; c.castShadow = false; c.receiveShadow = e.o.receiveShadow;
  c.raycast = noRaycast;                         // the parent answers for the leaf (walk/select/grab)
  c.userData.noWalkable = true; c.userData.foliageCore = true;
  c.visible = false;                             // shown only once its pipeline is warm (never a render-path compile)
  e.o.add(c);                                    // a child at identity: same world transform as the leaf mesh
  e.core = c;
  warm('foliage core', async () => {
    if (!e.core || !e.o.parent) return;
    const parent = c.parent; parent?.remove(c);  // detached while compiling: never drawn mid-compile
    c.visible = true;
    try { await renderer.compileAsync(c, camera, scene); c.userData.warmed = true; }
    finally { c.visible = false; parent?.add(c); }
    if (foliageEffective() === 'fast' && entries.has(e)) apply(e, 'fast');
  }, { p: P_AMBIENT }).catch(() => {});
  return c;
}

function apply(e, eff) {
  if (eff === 'fast') {
    if (!e.core) { makeCore(e); return; }        // the warm finishes the switch
    if (!e.core.userData.warmed) return;         // still compiling: blend-only until it can show without a stall
    e.core.visible = true;
    e.m.depthFunc = THREE.LessDepth;
  } else {
    if (e.core) e.core.visible = false;
    e.m.depthFunc = e.depthFunc;
  }
}

function applyAll() {
  const eff = foliageEffective();
  for (const e of entries) apply(e, eff);
}

/** prepareObject hook: remember a model's qualifying leaf meshes and put them in the current mode. */
export function registerFoliage(root) {
  root?.traverse?.((o) => {
    if (!qualifiesAsFoliage(o) || o.userData.foliage) return;
    const e = { o, m: o.material, depthFunc: o.material.depthFunc, core: null };
    o.userData.foliage = true;
    entries.add(e);
    e.m.addEventListener('dispose', () => {      // the model went away: forget it and free the twin
      entries.delete(e);
      if (e.core) { e.core.parent?.remove(e.core); e.core.material.dispose(); e.core = null; }
    });
    apply(e, foliageEffective());
  });
}

export function setFoliageMode(v) {
  if (!FOLIAGE_MODES.includes(v)) return mode;
  mode = v; lsSet(v);
  applyAll();
  return mode;
}

export const foliageDebug = () => ({ mode, effective: foliageEffective(), meshes: entries.size,
  cores: [...entries].filter((e) => e.core).length, showing: [...entries].filter((e) => e.core?.visible).length });

// auto follows the headset
renderer.xr?.addEventListener?.('sessionstart', () => { if (mode === 'auto') applyAll(); });
renderer.xr?.addEventListener?.('sessionend', () => { if (mode === 'auto') applyAll(); });
