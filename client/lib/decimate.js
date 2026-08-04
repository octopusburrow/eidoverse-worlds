// decimate — mesh simplification as a component (R's day-one processing pick:
// Orrery generates heavy meshes; a world that can wear them needs a dial).
//
// comp {id, type:'decimate', data:{ratio}} — ratio = fraction of vertices to
// KEEP (Blender collapse semantics: 0.5 halves the mesh). The log stores the
// PARAMETER; every client derives the same simplified mesh from the same
// content-addressed source bytes with the same deterministic edge-collapse
// (three's SimplifyModifier — pure function of geometry). Same doctrine as
// picture, heavier bytes. Originals are kept client-side so a ratio change
// or removal re-derives from source, never from a previous decimation
// (decimating a decimation would make history order-dependent).
//
// First PROCESSING component — the category that eventually makes the comp
// bag order-semantic (decimate-then-X ≠ X-then-decimate). With one processor
// there is no ordering question yet; the registry grows order when a second
// processor lands (design doc §1).

import { bus } from './core.js';
import { entities } from './world.js';
import { registerComponent } from './components.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';

const wanted = new Map();      // id -> ratio
const originals = new Map();   // id -> Map(mesh -> source geometry)
const applied = new Map();     // id -> ratio actually on the meshes now
const simplifier = new SimplifyModifier();

function apply(id) {
  const root = entities.get(id);
  if (!root) return;
  const ratio = wanted.get(id);
  let bank = originals.get(id);
  if (ratio == null) {                             // removed → restore sources
    if (bank) for (const [mesh, geo] of bank) { if (mesh.geometry !== geo) { mesh.geometry.dispose(); mesh.geometry = geo; } }
    applied.delete(id);
    return;
  }
  if (applied.get(id) === ratio) return;           // idempotent per fold/replay
  if (!bank) { bank = new Map(); originals.set(id, bank); }
  let touched = 0;
  root.traverse((m) => {
    if (!m.isMesh || !m.geometry?.attributes?.position) return;
    if (!bank.has(m)) bank.set(m, m.geometry);
    const src = bank.get(m);
    const verts = src.attributes.position.count;
    const remove = Math.floor(verts * (1 - ratio));
    if (remove <= 0) { if (m.geometry !== src) { m.geometry.dispose(); m.geometry = src; } touched++; return; }
    try {
      const simplified = simplifier.modify(src, remove);
      if (m.geometry !== src) m.geometry.dispose();
      m.geometry = simplified;
      touched++;
    } catch (e) {
      console.warn(`decimate: mesh in ${id} declined (${String(e).slice(0, 80)})`);
    }
  });
  if (touched) applied.set(id, ratio);
}

bus.on('comp', ({ id, type, data }) => {
  if (type !== 'decimate') return;
  if (data == null) { wanted.delete(id); apply(id); return; }
  const r = Math.min(1, Math.max(0.02, Number(data.ratio) || 1));
  wanted.set(id, r);
  applied.delete(id);
  apply(id);
});
bus.on('entity', ({ id } = {}) => {                // late-loading models
  if (id && wanted.has(id)) { applied.delete(id); apply(id); }
  else if (!id) for (const k of wanted.keys()) { applied.delete(k); apply(k); }
});

registerComponent('decimate', {
  hint: 'simplify the mesh — ratio of vertices kept (derived, deterministic)',
  defaults: { ratio: 0.5 },
});

/** harness window */
export const decimateDebug = (id) => {
  const root = entities.get(id);
  const counts = [];
  root?.traverse((m) => { if (m.isMesh && m.geometry?.attributes?.position) counts.push(m.geometry.attributes.position.count); });
  return { applied: applied.get(id) ?? null, vertCounts: counts };
};
