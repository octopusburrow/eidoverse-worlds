// Where to put a body that is stuck inside geometry (BUG-HUNT 2026-09-27 22:20: a reload
// restored R inside the temple roof, gravity pulled her down into it, and nothing could get
// her out). Pure: `probe(x, y, z)` stands a body at that point and answers what the collider
// resolver did -- `{x, z, ground}`, where x/z moved means a wall shoved the body (so the spot
// isn't free) and `ground` is the highest support at or below y + a step.
//
// Order is R's: (1) ON TOP of the support you were standing on -- whether you overlap it or have fallen
// through into the enclosed space under it (a reload that drops you through a roof: free, but walled in);
// (2) if you overlap something and nothing is above you, the nearest free spot at your own height; (3) a free
// body under open sky is left alone; (4) nothing -- the caller falls back to the world's start.
// Found by the browser probe, 10-03: the walk resolver already ejects a body from a plain box sideways, so
// "inside a slab" heals itself; the case that traps a person is the enclosed one, which "is it free?" misses.

export const SHOVE_EPS = 1e-3;
export const HEADROOM = 6.0;                 // how far above the feet to look for a roof to stand on
export const SCAN = 0.25;                    // probe heights step; under the resolver's 8cm floor band x3
export const RINGS = [0.75, 1.5, 2.5, 4, 6, 9, 12];
export const SPOKES = 12;

function standsFree(probe, x, y, z) {
  const p = probe(x, y, z);
  if (!Number.isFinite(p.ground)) return null;
  if (Math.hypot(p.x - x, p.z - z) > SHOVE_EPS) return null;
  return p.ground;
}

/** Is the body at `pos` free right now (no shove, feet within a step of the ground)? */
export function isFree(probe, pos, step = 0.55) {
  const g = standsFree(probe, pos.x, pos.y, pos.z);
  return g !== null && g <= pos.y + 1e-6 && pos.y - g <= step + 1e-6;
}

/** → {x, y, z, how: 'free' | 'on-top' | 'nearby'} or null (caller respawns). */
export function findFreeSpot(probe, pos, step = 0.55) {
  // (1) on top: scan probe heights upward. A probe inside a slab is shoved (rejected); the first one that
  // clears a slab's top stands on it (the resolver's floor band) -- so this finds the NEAREST roof above you,
  // not the highest. One probe from a fixed height landed inside a roof starting at that height (probe, 10-03).
  for (let h = pos.y + step + SCAN; h <= pos.y + HEADROOM; h += SCAN) {
    const top = standsFree(probe, pos.x, h, pos.z);
    if (top !== null && top > pos.y + step) return { x: pos.x, y: top, z: pos.z, how: 'on-top' };
  }

  if (isFree(probe, pos, step)) return { x: pos.x, y: pos.y, z: pos.z, how: 'free' };

  // (2) nearest free spot at my own height, ring by ring
  for (const r of RINGS) {
    for (let k = 0; k < SPOKES; k++) {
      const a = (k / SPOKES) * Math.PI * 2;
      const x = pos.x + r * Math.cos(a), z = pos.z + r * Math.sin(a);
      const g = standsFree(probe, x, pos.y + step, z);
      if (g !== null) return { x, y: g, z, how: 'nearby' };
    }
  }
  return null;
}
