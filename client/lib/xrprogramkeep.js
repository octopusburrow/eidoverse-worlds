// KEEP BOTH SHADER VARIANTS ACROSS THE VR SWITCH (vr-exit-hang-commons: "why is entering and leaving VR such a
// heavy cost in the first place?").
//
// three r186 keys a render object on (object, material, render context, lights), not the camera, but the XR
// stereo ArrayCamera changes its dynamic cache key (`cameras.length`). So at every enter and every exit each
// object is disposed and rebuilt IN THE SAME SLOT; the old pipeline loses its last user, and Pipelines
// deletes it from its caches (_releasePipeline / _releaseProgram only drop map entries — GL objects go to GC).
// The desktop variant is thrown away at entry, so the FIRST EXIT recompiles every material that existed before
// the session (measured: tools/xr-switch-compile-probe.mjs) — in a heavy world a long synchronous hang (Rab's exit;
// R's "wait" dialog). Materials first realized DURING the session have no desktop variant; this can't help those.
//
// Basis's model: a mode switch is a presentation change, not a rebuild. Here: a released program/pipeline
// stays findable (usedTimes 0) in a bounded LRU; the next switch looks its variant up and finds it. Eviction
// past the cap does the real release, and only if nothing picked the entry back up meanwhile.
// tools/xr-switch-compile-probe.mjs measures it against stock three.
export function keepProgramsAcrossXR(renderer, { cap = 768 } = {}) {
  const p = renderer?._pipelines;
  if (!p || p.__keptAcrossXR || typeof p._releaseProgram !== 'function' || typeof p._releasePipeline !== 'function') return null;
  const release = { program: p._releaseProgram.bind(p), pipeline: p._releasePipeline.bind(p) };
  const kept = new Map();   // insertion order = least recently released first
  const trim = () => {
    while (kept.size > cap) {
      const [obj, kind] = kept.entries().next().value;
      kept.delete(obj);
      if (obj.usedTimes === 0) release[kind](obj);   // still unused: now it really goes
    }
  };
  p._releaseProgram = (program) => { kept.delete(program); kept.set(program, 'program'); trim(); };
  p._releasePipeline = (pipeline) => { kept.delete(pipeline); kept.set(pipeline, 'pipeline'); trim(); };
  const handle = { get size() { return kept.size; }, cap };
  p.__keptAcrossXR = handle;
  return handle;
}
