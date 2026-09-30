# LOD floor census

Library: 36 models. Reducer: `lod3-r25-px2ppd25-tpp1-tx5-d80k4f45h25-texel1024-min12000` minus its floor (ratio 0.25). Each model ran once at floor 250. At a higher floor, a model under it keeps its geometry but still gets a texture-only LOD when its LOD textures come to at most 0.5 of the KTX2 tier's (the reducer's rule): such rows are PROJECTED from the measured run (verts and tris unchanged, texture MB as measured, LOD bytes those of the measured LOD, an approximation); the rest read as light. Texture MB is glbperf's GPU-size estimate: raw images at full size, KTX2 at its compressed size. The KTX2 variant is what a viewer is served up close, so it is the fair baseline for what a LOD saves on textures. Animated, skinned and morph-target models are refused before counting (structural) at every floor and aren't in the rows.

| Floor | Enter | Built | (permissive) | (texture-only) | Refused: light | ineffective | preservation | structural | gpu | size | other/error | Verts in → out | Tris in → out | Bytes in → out | Tex MB: raw / KTX2 variant → LOD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12,000 | 36 | 27 | 2 | 15 | 8 | 0 | 0 | 1 | 0 | 0 | 0 | 1,099,820 → 438,739 | 1,675,558 → 493,147 | 131,964,972 → 10,239,148 | 1130.0 / 131.5 → 19.0 |
| 1,000 | 36 | 28 | 7 | 1 | 6 | 1 | 0 | 1 | 0 | 0 | 0 | 1,110,928 → 383,621 | 1,685,254 → 427,410 | 132,493,428 → 12,038,804 | 1146.8 / 135.7 → 23.2 |
| 500 | 36 | 31 | 10 | 1 | 2 | 2 | 0 | 1 | 0 | 0 | 0 | 1,113,808 → 384,260 | 1,686,214 → 427,722 | 132,565,192 → 12,045,648 | 1146.8 / 135.7 → 23.2 |
| 250 | 36 | 31 | 10 | 1 | 2 | 2 | 0 | 1 | 0 | 0 | 0 | 1,113,808 → 384,260 | 1,686,214 → 427,722 | 132,565,192 → 12,045,648 | 1146.8 / 135.7 → 23.2 |

## What each step down adds

- **1,000–12,000 verts**: 15 more LODs, saving 66,226 vertices in total (median original 6,931), at 4,154,012 extra bytes of LOD files.
- **500–1,000 verts**: 4 more LODs, saving 2,241 vertices in total (median original 960), at 398,656 extra bytes of LOD files.
- **250–500 verts**: 0 more LODs, saving 0 vertices in total (median original -), at 0 extra bytes of LOD files.

## Permissive-only, refused and errored models

- `eidoverse__assets__models__cactus_wren_bird_animated_desert_songbird_calling_hopping_walking.glb`: structural, 0 → 0 verts: unsupported: skinned/avatar asset (skins)
- `eidoverse__assets__models__crate_large_red.glb`: built (texture-only), 521 → 521 verts
- `eidoverse__assets__models__palm_date_tree_tropical_deseert_oasis_plant.glb`: built (permissive retry), 6,931 → 1,951 verts
- `eidoverse__assets__models__stylized_yucca_joshua_tree_desert_cactus_plant.glb`: built (permissive retry), 19,529 → 7,896 verts
- `store__12c847aa7193d893.glb`: built (permissive retry), 5,813 → 1,460 verts
- `store__3c482a695baa67c3.glb`: built (permissive retry), 960 → 146 verts
- `store__51e89248637cef21.glb`: built (permissive retry), 7,672 → 2,118 verts
- `store__910e1f8f12012568.glb`: ineffective, 708 → 638 verts: reduction ineffective (708 -> 638 verts, permissive too; textures 100% of the full tier)
- `store__95d9aa3d18b77612.glb`: built (permissive retry), 11,108 → 3,041 verts
- `store__abe5d4a0323bce76.glb`: built (permissive retry), 960 → 279 verts
- `store__acbb7bce3766160b.glb`: built (permissive retry), 960 → 214 verts
- `store__dc14b0b7966bc883.glb`: built (permissive retry), 20,280 → 5,484 verts
- `store__dff15b930d4d84c5.glb`: ineffective, 7,413 → 6,923 verts: reduction ineffective (7413 -> 6923 verts, permissive too; textures 100% of the full tier)
- `store__e40ba7dfda9a1a67.glb`: built (permissive retry), 9,046 → 2,770 verts
