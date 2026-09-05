// The body-first gate: the world's models wait to PARSE until your own body
// is on screen. Measured 09-04/05 (bodytime probe): at P_GATE the body still
// took 23 s from load, because every "real frame" the warm conductor waits
// between the body's pipeline compiles was a 300–450 ms frame under the
// world's GLB parses — and R reloaded faster than that and never saw a body.
// Downloads are not gated (the network is parallel and free); only the CPU
// lane's parse+texture pass is held. Released by setMe, by the viewer path
// (no body expected), by a failed body, and by a 12 s race in loadGLB so a
// hung body can never hold the world hostage. After the first release the
// gate is a resolved promise — a palette spawn later pays nothing.
// No imports on purpose: assets.js and mybody.js both reach it, and the
// module graph already has assets → avatar → assets-shaped cycles enough.
let release = null;
let released = false;
const gate = new Promise((res) => { release = res; });
export function bodyGate() { return gate; }
export function releaseBodyGate(why = 'body') {
  if (released) return;
  released = true;
  try { console.log(`[body] gate open: ${why}`); } catch { /* headless */ }
  release?.();
}
export const bodyGateOpen = () => released;
