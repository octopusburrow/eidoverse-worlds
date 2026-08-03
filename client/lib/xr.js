// xr — the door into the headset. Lab spike (task #5), ported knowledge from
// exultation's input/xr.ts and the porch WebXR implementation.
//
// Shape of the thing: the backend split happens at BOOT (?xr=1 → WebGL2, see
// core.js), so this module has two jobs depending on which side it wakes on.
// Without the flag it offers a small "VR" chip — visible only when a headset
// browser is actually present — that reloads into the XR boot. With the flag
// it owns the session: an Enter VR button, the rig, and the follow logic that
// replaces the desktop camera while presenting.
//
// The rig is a Group the camera rides in; the headset pose composes on top of
// the rig transform, so moving the BODY (WASD, and later stick locomotion)
// moves the rig and the head stays the head. Never move the camera directly
// while presenting — that's the porch lesson generalized: the tracked pose is
// the headset's to write, the rig is ours.

import { THREE, renderer, camera, scene, CONFIG, XR_BOOT, report } from './core.js';
import { myState, setXrProbe } from './controller.js';
import { flashHint } from './ui.js';

const rig = new THREE.Group();
rig.name = 'xr-rig';
let presenting = false;
export const isPresenting = () => presenting;

async function enterVR() {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);
    // The camera moves into the rig; its desktop transform is irrelevant now —
    // the XR pose overwrites it every frame, relative to the rig.
    rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
    rig.rotation.y = myState.yaw;
    scene.add(rig);
    rig.add(camera);
    presenting = true;
    session.addEventListener('end', () => {
      presenting = false;
      rig.remove(camera);
      scene.remove(rig);
      camera.position.set(3.5, 2.6, 5.5); // desktop follow-cam takes over next frame
    });
  } catch (e) {
    report('enter VR', e);
    flashHint('VR session failed — see console');
  }
}

/** Per-frame while presenting: the body's position drives the rig, so desktop
 *  movement keys (and later, sticks) walk the headset through the world. */
export function updateXR() {
  if (!presenting) return;
  rig.position.set(myState.pos.x, myState.pos.y, myState.pos.z);
}

export async function initXR() {
  if (!navigator.xr) return;
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); }
  catch (e) { report('xr support probe', e); }
  if (!supported) return;

  const b = document.createElement('button');
  b.className = 'panel xr-chip';
  b.style.cssText = 'position:fixed; bottom:12px; right:12px; z-index:30; font-size:14px; padding:8px 14px;';
  if (!XR_BOOT) {
    // On the WebGPU boot a session can't start (backend). Reload into the XR
    // boot — BEFORE any session exists, so this never kills a live one.
    b.textContent = '🥽 VR';
    b.onclick = () => {
      const u = new URL(location.href); u.searchParams.set('xr', '1'); location.href = u;
    };
  } else {
    b.textContent = '🥽 enter VR';
    b.onclick = enterVR;
  }
  document.body.appendChild(b);
  setXrProbe(() => presenting);
}
