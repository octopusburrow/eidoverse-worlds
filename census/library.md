# LOD floor census

Library: 61 models. Reducer: `lod3-r25-px2ppd25-tpp1-tx5-d80k4f45h25-texel1024-min1000` minus its floor (ratio 0.25). Each model ran once at floor 250; a floor's census is the models whose original has at least that many vertices. Texture MB is glbperf's GPU-size estimate: raw images at full size, KTX2 at its compressed size. The KTX2 variant is what a viewer is served up close, so it is the fair baseline for what a LOD saves on textures. Animated, skinned and morph-target models are refused before counting (structural) at every floor and aren't in the rows.

| Floor | Enter | Built | (permissive) | (texture-only) | Refused: light | ineffective | preservation | structural | gpu | size | other/error | Verts in → out | Tris in → out | Bytes in → out | Tex MB: raw / KTX2 variant → LOD |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12,000 | 14 | 12 | 5 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2,058,425 → 532,894 | 1,867,436 → 476,043 | 422,813,484 → 13,003,564 | 1804.5 / 82.6 → 25.1 |
| 1,000 | 44 | 40 | 11 | 1 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 2,218,871 → 602,968 | 2,011,557 → 521,426 | 795,148,908 → 29,530,896 | 4630.1 / 252.1 → 73.2 |
| 500 | 51 | 46 | 11 | 5 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 2,222,576 → 605,519 | 2,014,945 → 523,220 | 833,774,640 → 31,578,008 | 5027.2 / 284.2 → 79.8 |
| 250 | 53 | 47 | 12 | 5 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 2,222,936 → 605,667 | 2,015,125 → 523,292 | 833,787,164 → 31,581,980 | 5027.2 / 284.2 → 79.8 |

## What each step down adds

- **1,000–12,000 verts**: 28 more LODs, saving 90,372 vertices in total (median original 7,219), at 16,527,332 extra bytes of LOD files.
- **500–1,000 verts**: 6 more LODs, saving 1,154 vertices in total (median original 521), at 2,047,112 extra bytes of LOD files.
- **250–500 verts**: 1 more LODs, saving 212 vertices in total (median original 360), at 3,972 extra bytes of LOD files.

## Permissive-only, refused and errored models

- `apocalyptic_destroyed_rubble_debris_pile_ruins.glb`: ineffective, 17,218 → 16,691 verts: reduction ineffective (17218 -> 16691 verts, permissive too; textures 100% of the full tier)
- `bagger_288_bucketwheel_excavator_mining_extraction.glb`: structural, 0 → 0 verts: unsupported: animated object (v1 reduces static geometry only)
- `cactus_wren_bird_animated_desert_songbird_calling_hopping_walking.glb`: structural, 0 → 0 verts: unsupported: skinned/avatar asset (skins)
- `computer_servers_rack_with_fans_on_back_row_of_four_4_columns.glb`: built (permissive retry), 990,158 → 185,591 verts
- `computer_servers_rack_with_fans_on_back_single_column.glb`: built (permissive retry), 246,635 → 45,937 verts
- `crate_large_blue.glb`: built (texture-only), 521 → 521 verts
- `crate_large_green.glb`: built (texture-only), 521 → 521 verts
- `crate_large_red.glb`: built (texture-only), 521 → 521 verts
- `crate_large_yellow.glb`: built (texture-only), 521 → 521 verts
- `crow_bird_animated_corvid_raven_black_cawing_flying_walking.glb`: structural, 0 → 0 verts: unsupported: skinned/avatar asset (skins)
- `cyberpunk_scifi_apocalyptic_burnt_destroyed_damaged_car.glb`: ineffective, 16,987 → 15,674 verts: reduction ineffective (16987 -> 15674 verts, permissive too; textures 100% of the full tier)
- `destroyed_apocalptic_burnt_derelict_damaged_car.glb`: structural, 0 → 0 verts: unsupported: morph targets the reducer cannot prove preserved
- `jeoffry.glb`: built (permissive retry), 360 → 148 verts
- `palm_date_tree_tropical_deseert_oasis_plant.glb`: built (permissive retry), 6,931 → 1,951 verts
- `scifi_barrels_group_of_four.glb`: built (permissive retry), 10,395 → 2,338 verts
- `scifi_barrels_single.glb`: built (permissive retry), 2,582 → 565 verts
- `scifi_barrels_strapped_to_scifi_pallet.glb`: built (permissive retry), 12,483 → 3,040 verts
- `scifi_barrels_strapped_to_scifi_pallet_with_plastic_wrap_on_top.glb`: built (permissive retry), 12,947 → 3,191 verts
- `scifi_cyberpunk_intermodal_shipping_container_crate_blue.glb`: ineffective, 2,344 → 1,936 verts: reduction ineffective (2344 -> 1936 verts, permissive too; textures 77% of the full tier)
- `scifi_cyberpunk_tank_military_artillery_apc_gun_weapon_animated.glb`: structural, 0 → 0 verts: unsupported: animated object (v1 reduces static geometry only)
- `scifi_perimeter_wall_gate.glb`: built (texture-only), 1,466 → 1,464 verts
- `scifi_perimeter_wall_middle_use_between_two_pillars.glb`: ineffective, 812 → 788 verts: reduction ineffective (812 -> 788 verts, permissive too; textures 100% of the full tier)
- `scifi_perimeter_wall_pillar.glb`: ineffective, 449 → 449 verts: reduction ineffective (449 -> 449 verts, permissive too; textures 100% of the full tier)
- `scifi_perimeter_watchtower_standalone_or_with_wall_middle_four_way.glb`: ineffective, 1,328 → 1,328 verts: reduction ineffective (1328 -> 1328 verts, permissive too; textures 100% of the full tier)
- `scifi_single_pallet.glb`: built (permissive retry), 1,135 → 576 verts
- `scifi_stack_of_pallets.glb`: built (permissive retry), 9,959 → 4,955 verts
- `scifi_stack_of_pallets_with_one_leaning_on_side.glb`: built (permissive retry), 11,322 → 5,427 verts
- `stylized_yucca_joshua_tree_desert_cactus_plant.glb`: built (permissive retry), 19,529 → 7,896 verts
- `tiger_shark_swimming_animated_ocean_sea_predator_fish.glb`: structural, 0 → 0 verts: unsupported: skinned/avatar asset (skins)
