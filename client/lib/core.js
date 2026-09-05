// core — the PRESENTATION substrate: renderer, scene, camera, canvas, the
// base lights and stage floor, and the eidoverse module-host contract. The
// renderer-free substrate (bus, CONFIG, report, colours, helpers) lives in
// base.js (RENDERER-SEAM move 2) — modules that never touch the GPU import
// THAT and stop depending on this file transitively.
//
// Import rule: core imports nothing from the client except base.js (which
// imports nothing at all). Everything else may import either. The module
// graph stays acyclic at load time even where the runtime call graph is
// circular.

import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { CONFIG } from './base.js';

export { THREE, TSL };

// ------------------------------------------------------------ wgsl debug
// ?wgsldebug — surface Tint's REAL compilation diagnostics (Chrome only logs
// "invalid due to a previous error" at pipeline time; the substance lives in
// getCompilationInfo on the shader module).
if (CONFIG.params.has('wgsldebug') && globalThis.GPUDevice) {
  const orig = GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule = function (desc) {
    const mod = orig.call(this, desc);
    mod.getCompilationInfo?.().then((info) => {
      const errs = info.messages.filter((m) => m.type === 'error');
      if (!errs.length) return;
      for (const m of errs.slice(0, 3)) {
        console.error(`[wgsl] ${m.lineNum}:${m.linePos} ${m.message}`);
        const lines = desc.code.split('\n');
        console.error('[wgsl-src]\n' + lines.slice(Math.max(0, m.lineNum - 3), m.lineNum + 2)
          .map((l, i) => `${Math.max(0, m.lineNum - 3) + i + 1}: ${l}`).join('\n'));
      }
    });
    return mod;
  };
}

// ------------------------------------------------------------ renderer
export const canvas = document.createElement('canvas');
// focusable so pointer-lock re-entry works after an Esc unlock: Chrome wants
// the request to come from a focused target, and a canvas is not focusable by
// default.
canvas.tabIndex = -1;
canvas.style.outline = 'none';
document.body.prepend(canvas);

// MSAA policy (§22n measured, §22r reverted to ON): the 4×MSAA resolve at
// 2× retina costs ~4ms/frame (+10fps when dropped, drift-controlled A/B),
// but a silently-vanished AA reads as a rendering bug to anyone not holding
// the measurement — so MSAA stays the default everywhere and ?msaa=0 is the
// opt-out lever (the +10fps is one flag away; §22q bought the frames back
// for the default look). The dPR-gated auto-off waits for a real settings
// row alongside the other quality dials.
// ?webgl=1 forces three's WebGL 2 backend — the path a browser without WebGPU
// (Firefox stable, older Safari, most WebXR runtimes today) takes on its own.
// Both are renderer-construction choices, so they apply on the next load: the
// URL param wins for a session (the A/B lever), the persisted preference
// (video settings) otherwise.
export const PREF_MSAA = 'ew-msaa', PREF_BACKEND = 'ew-backend';
const pref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };   // a storage throw must not kill boot
// ?xr=1 is a BOOT flag, not a runtime toggle: three 0.185's XRManager rides
// WebGPU (XRGPUBinding — Chrome, flags today) but only if the adapter was
// requested xrCompatible, which the backend reads off renderer.xr.enabled at
// init() time. So the flag sets xr.enabled BEFORE init below. Where the
// browser has no XRGPUBinding three falls back to the WebGL path on its own.
// The r184-era "VR = WebGL2 only" rule is gone with the bump.
export const XR_BOOT = CONFIG.params.has('xr');
// TOLERANT RENDER LIST (XR strobe, 08-05): something leaves holes in the
// per-eye render list mid-session ("Cannot destructure 'object' of
// renderList[i]"), and the stock loop throws — one hole kills the whole
// frame, which reads as the world blinking in the headset. Skip holes, render
// everything else, log the first few with a stack. Patched on the CLASS
// PROTOTYPE before construction — an instance patch verifiably engaged yet
// raw crashes continued (some path holds a constructor-time binding).
// REIMPLEMENTED, not wrapped: the list mutates DURING iteration (the stock
// loop caches its length and then dereferences a vacated slot).
if (XR_BOOT) {
  const proto = THREE.WebGPURenderer?.prototype;
  const orig = proto?._renderObjects;
  let logged = 0;
  if (orig) {
    proto._renderObjects = function (renderList, cam, scn, lightsNode, passId = null) {
      for (let i = 0; i < renderList.length; i++) {
        const item = renderList[i];
        if (!item) {
          if (logged < 5) {
            logged++;
            const err = new Error(`renderList hole at ${i}/${renderList.length}, pass=${passId}, xr=${this.xr?.isPresenting}`);
            globalThis.__errLog?.push?.(`${err.message} :: ${err.stack?.split('\n').slice(2, 5).join(' | ')}`);
            console.warn('[renderlist]', err.message);
          }
          continue;
        }
        const { object, geometry, material, group, clippingContext } = item;
        this._currentRenderObjectFunction(object, scn, cam, geometry, material, group, lightsNode, clippingContext, passId);
      }
    };
  }
}

export const renderer = new THREE.WebGPURenderer({ canvas,
  antialias: (CONFIG.params.get('msaa') ?? pref(PREF_MSAA)) !== '0',
  forceWebGL: CONFIG.params.get('webgl') === '1'
    || (CONFIG.params.get('webgl') == null && pref(PREF_BACKEND) === 'webgl') });
/** 'webgpu' | 'webgl' — known once renderer.init() resolves. */
export const backendName = () => (renderer.backend?.isWebGLBackend ? 'webgl' : 'webgpu');
// Still in 0.185.1; FIXED on three dev (db1daf163, 2026-07-24, #34088 —
// after the r185 tag, so it ships with r186): XRManager.onAnimationFrame
// calls foveateBoundTexture(_getFrameBufferTarget()); Renderer.js:1432
// returns NULL when no tonemap/colorspace pass is needed and XRManager:655
// reads .isPostProcessingRenderTarget off it → every XR frame throws inside
// three before the app callback (world freezes, head tracking stays live).
// Same one-line guard as dev's; DELETE at the r186 bump.
if (XR_BOOT) {
  renderer.xr.enabled = true;   // must precede init(): xrCompatible adapter
  const fov = renderer.xr.foveateBoundTexture?.bind(renderer.xr);
  if (fov) renderer.xr.foveateBoundTexture = (rt) => (rt == null ? undefined : fov(rt));
}
renderer.setSize(innerWidth, innerHeight);
// Spectators start a notch lower — an audience laptop's job is 30fps for an
// hour, not maximum sharpness. Adaptive scaling adjusts from here.
export const BASE_PIXEL_RATIO = Math.min(devicePixelRatio, CONFIG.spectate ? 1.5 : 2);
renderer.setPixelRatio(BASE_PIXEL_RATIO);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init();
// the splash watchdog (index.html) stops worrying: modules resolved and the
// GPU answered — everything past this point can report its own failures
globalThis.__ewEngineUp = true;

export const scene = new THREE.Scene();
// the construct (no sky yet) wears the PANEL family — deep-ocean dark — not a
// navy that fought the teal chrome (R, 09-05)
scene.background = new THREE.Color(0x051414);
scene.fog = new THREE.FogExp2(0x051414, 0.018);

// The far plane has to hold the SKY, not just the scene. Skye's world-space
// sky builds a cloud dome ~3200 units out, and the ringworld package hangs its
// band 4940 up — at the old far plane of 300 the entire atmosphere was clipped
// away and the sky rendered black while the ground looked perfectly fine.
// WebGPU's reversed-Z keeps depth precision honest across this range in a way
// WebGL's would not.
export const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 20000);
camera.position.set(3.5, 2.6, 5.5);
camera.lookAt(0, 1, 0);

addEventListener('resize', () => {
  // XR owns the framebuffer while presenting: resizing it mid-session tears
  // the eye buffers. Aspect math is still safe to keep warm.
  if (!renderer.xr?.isPresenting) renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ------------------------------------------------------------ base lighting
// The sky module owns these once a sky verb lands; these are the "empty world"
// defaults so a fresh world is not pitch black.
export const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x283024, 0.75);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(14, 22, 10);
scene.add(sun);

// The stage floor, replaced the moment a terrain verb lands.
export const ground = new THREE.Mesh(
  new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardNodeMaterial({ color: 0x2a3440, roughness: 0.9, metalness: 0.05 }),
);
ground.receiveShadow = true;
scene.add(ground);
export const grid = new THREE.GridHelper(160, 80, 0x1e3a36, 0x122622);   // low-contrast teal: 1px lines alias less when they shout less (a shader grid is the real fix)
// XR per-eye frustum culling misjudges huge planes (in-headset 08-05: the
// ground VANISHES at some head angles) — one draw call each, never cull them
ground.frustumCulled = false;
grid.frustumCulled = false;
grid.position.y = 0.01;
scene.add(grid);

// ---------------------------------------------------------- eidoverse host
// The browser as a compliant eidoverse module host: same globalThis contract as
// render_scene.mjs, so toolkit files (terrain.js, grass.js, sky_system.js, …)
// eval-load UNMODIFIED from Skye's repo via /library.

globalThis.THREE = Object.assign({}, THREE, TSL); // engine merges three/tsl into THREE
// We render FORWARD (single color target), not the engine's MRT pipeline.
// Eidoverse modules guard their G-buffer opt-outs on the presence of THREE.mrt,
// and an mrtNode in a forward pipeline emits an EMPTY fragment output struct
// that Chrome/Tint rejects. Two belts: a non-MRT host honestly declares itself
// by not exposing mrt, AND upstream now honours an explicit opt-out flag
// (EANPA_NO_MRT), which is the supported way as of the eanpa sky port.
delete globalThis.THREE.mrt;
globalThis.EANPA_NO_MRT = true;
globalThis._s = scene; globalThis._c = camera; globalThis._r = renderer;
globalThis._sun = sun; globalThis._hemi = hemi;
globalThis._sceneTime = 0;
