# Review evidence for #207 (LOD generation 3)

Produced at `eb0b9f2`; `f6f503b` (the PR head) changes tests and restates the same density formula, so these stand.

- `census/library.md`, `census/commons.md`: `tools/lod-census.ts` over the model library (61 models) and the Commons'
  placed store models, at floors 12,000 / 1,000 / 500 / 250, with every refusal typed.
- `look/sheet.png`: `tools/lod-look-probe.mjs`, 12 models. Per model, two rows: the 'auto' switch distance and the eco
  distance (half of it). Columns: the served full tier | the LOD | the amplified difference.
  `look/sheet-N-{auto,eco}.png` are the same rows one by one; `look/probe.log` has the per-model numbers.
- `look-extra/`: the same probe at `f6f503b` on three more: the date palm (alpha-BLEND foliage, a Permissive-retry
  LOD), a large crate (texture-only, under the vertex floor) and the perimeter wall gate (texture-only).
