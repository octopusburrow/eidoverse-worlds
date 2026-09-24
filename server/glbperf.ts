// glbperf — a model's loupe rank read from its GLB, without rendering it (library cards; R, 09-24).
//
// Mirrors what the client does: three's GLTFLoader turns every triangle primitive of every mesh-bearing node in the
// default scene into ONE Mesh (EXT_mesh_gpu_instancing → an InstancedMesh of `count`), and perfscope's accumulate()
// bills per Mesh: tris = index (or position) count / 3 × instances, one draw, its material into a unique set, one
// alpha tick per BLEND material occurrence; textures once per unique texture, w×h×4 bytes (×4/3 with mips); bones =
// the largest skin. The rule and thresholds are shared/perfrank.js — the loupe's own. tools/glbperf-parity-probe
// loads real library models through the client's loader and checks these numbers against perfscope.statsOf().
//
// Known approximations, disclosed on the card: KTX2/basis images are billed at 1 byte/texel (the GPU format depends
// on the viewer's hardware); an image this cannot size (not PNG/JPEG/WebP/KTX2) is billed as 0 and counted in
// `unsizedImages`. Ranks the ORIGINAL upload — a served KTX2 variant costs less texture memory.
import { readFileSync, statSync } from "node:fs";
import { parseGlb, rasterDims } from "./glbparse.ts";
import { rankOf, TIER_NAMES } from "../shared/perfrank.js";

export type GlbPerf = { tris: number; draws: number; mats: number; alpha: number; bones: number; texMB: number;
  unsizedImages: number; rank: number; rankName: string; worst: string; tiers: Record<string, number> };

const MODE_TRIANGLES = 4, MODE_STRIP = 5, MODE_FAN = 6;
const NEAREST = 9728, LINEAR = 9729;

function webpDims(b: Uint8Array): [number, number] | null {
  if (b.length < 30 || String.fromCharCode(...b.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...b.subarray(8, 12)) !== "WEBP") return null;
  const kind = String.fromCharCode(...b.subarray(12, 16));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (kind === "VP8X") return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
  if (kind === "VP8L") { const v = dv.getUint32(21, true); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  if (kind === "VP8 ") return [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff];
  return null;
}
function ktx2Dims(b: Uint8Array): [number, number] | null {
  if (b.length < 28 || b[0] !== 0xab || b[1] !== 0x4b) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return [dv.getUint32(20, true), dv.getUint32(24, true)];
}

export function glbPerf(bytes: Uint8Array): GlbPerf {
  const { json, bin } = parseGlb(bytes);
  const nodes: any[] = json.nodes ?? [], meshes: any[] = json.meshes ?? [], accessors: any[] = json.accessors ?? [];
  const scene = (json.scenes ?? [])[json.scene ?? 0];
  let tris = 0, draws = 0, alpha = 0;
  const mats = new Set<number>();
  const visit = (ni: number, seen: Set<number>) => {
    if (seen.has(ni)) return; seen.add(ni);
    const n = nodes[ni]; if (!n) return;
    if (n.mesh != null) {
      const inst = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
      const count = inst ? (accessors[Object.values(inst)[0] as number]?.count ?? 1) : 1;
      for (const p of meshes[n.mesh]?.primitives ?? []) {
        const mode = p.mode ?? MODE_TRIANGLES;
        if (mode !== MODE_TRIANGLES && mode !== MODE_STRIP && mode !== MODE_FAN) continue;   // lines/points: not a Mesh
        const n0 = p.indices != null ? accessors[p.indices]?.count ?? 0 : accessors[p.attributes?.POSITION]?.count ?? 0;
        const idx = mode === MODE_TRIANGLES ? n0 : Math.max(0, n0 - 2) * 3;   // GLTFLoader re-indexes strips/fans
        tris += Math.round(idx / 3) * count;
        draws += 1;
        const mi = p.material ?? -1;                                           // -1: GLTFLoader's one default material
        mats.add(mi);
        if (mi >= 0 && json.materials?.[mi]?.alphaMode === "BLEND") alpha += 1;
      }
    }
    for (const c of n.children ?? []) visit(c, seen);
  };
  const seen = new Set<number>();
  for (const r of scene?.nodes ?? []) visit(r, seen);
  // textures: every texture index the USED materials reference (GLTFLoader loads textures per material)
  const texIdx = new Set<number>();
  // glTF's textureInfo objects are exactly the values of keys ending in "Texture" (baseColorTexture, normalTexture,
  // occlusionTexture, … and every KHR_materials_* extension's *Texture) — walk the material for those
  const walk = (v: any) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (/Texture$/.test(k) && typeof (x as any)?.index === "number") texIdx.add((x as any).index);
      else walk(x);
    }
  };
  for (const mi of mats) if (mi >= 0) walk(json.materials?.[mi]);
  let texBytes = 0, unsizedImages = 0;
  const loaded = new Set<string>();   // GLTFLoader caches Textures by source:sampler — two glTF textures on one image
  for (const ti of texIdx) {          // and sampler are ONE Texture (and one upload); the loupe counts objects
    const t = json.textures?.[ti]; if (!t) continue;
    const src = t.extensions?.KHR_texture_basisu?.source ?? t.extensions?.EXT_texture_webp?.source ?? t.source;
    const cacheKey = `${src}:${t.sampler ?? -1}`;
    if (loaded.has(cacheKey)) continue;
    loaded.add(cacheKey);
    const img = json.images?.[src]; const bv = img?.bufferView != null ? json.bufferViews?.[img.bufferView] : null;
    const b = bv ? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength) : null;
    const mime = img?.mimeType ?? "";
    const k2 = b && mime === "image/ktx2" ? ktx2Dims(b) : null;
    const dims = !b ? null : k2 ?? (mime === "image/webp" ? webpDims(b) : rasterDims(b, mime));
    if (!dims) { unsizedImages++; continue; }
    const sampler = json.samplers?.[t.sampler];
    const mips = !(sampler?.minFilter === NEAREST || sampler?.minFilter === LINEAR);
    texBytes += Math.round(dims[0] * dims[1] * (k2 ? 1 : 4) * (mips ? 4 / 3 : 1));
  }
  let bones = 0;
  for (const s of json.skins ?? []) bones = Math.max(bones, s.joints?.length ?? 0);
  const texMB = texBytes / 1e6;
  const r = rankOf({ tris, draws, texMB, bones, mats: mats.size, alpha });
  return { tris, draws, mats: mats.size, alpha, bones, texMB: +texMB.toFixed(2), unsizedImages,
    rank: r.rank, rankName: TIER_NAMES[r.rank], worst: r.worst, tiers: r.tiers };
}

const cache = new Map<string, { key: string; perf: GlbPerf | null }>();
/** glbPerf for a file on disk, cached on (size, mtime) — the catalog route runs per keystroke. null = unreadable. */
export function glbPerfOfFile(path: string): GlbPerf | null {
  try {
    const st = statSync(path);
    const key = `${st.size}:${st.mtimeMs}`;
    const hit = cache.get(path);
    if (hit?.key === key) return hit.perf;
    const perf = glbPerf(new Uint8Array(readFileSync(path)));
    cache.set(path, { key, perf });
    return perf;
  } catch { return null; }
}
