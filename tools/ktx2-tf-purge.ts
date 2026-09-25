// bun tools/ktx2-tf-purge.ts <OPT_DIR> [--apply] — find (and with --apply, delete) the KTX2 variants whose DATA maps
// had the sRGB→linear curve baked in by `ktx create` before the transfer fix (optimize.ts ktx2EncodeArgs --assign-tf).
// The boot sweep (upload.ts) rebuilds every missing variant on the next restart. Dry run by default: it lists.
//
// Which files: a ktx-create-written KTX2 image with a LINEAR transfer (a normal/roughness/occlusion map) —
//   inside a .ktx2.glb / .ktx2.vrm / .lod.*.glb: only when the image lacks optimize.ts's KTX2_TF_MARK (every image
//     encoded since the fix carries it), so a rerun after the rebuild finds nothing;
//   a loose <img>.ktx2: has no wrapper to carry a mark, so EVERY linear one is listed. Run this once, right after
//     deploying the fix; a second run would just rebuild those few images again (seconds each).
// Colour (sRGB) images were never affected: an sRGB source assigned an sRGB format is not converted.
//
// After --apply: rotate shared/ktx2.js KTX2_KEY (store answers are served immutable under ?ktx2=<key> — browsers and
// nginx would keep the bad bytes for a year) and restart; the sweep rebuilds.
import { parseGlb } from "../server/glbparse.ts";
import { KTX2_TF_MARK } from "../server/optimize.ts";
import { readFileSync, rmSync } from "node:fs";
import { Glob } from "bun";

const root = process.argv[2];
const apply = process.argv.includes("--apply");
if (!root) { console.error("usage: bun tools/ktx2-tf-purge.ts <OPT_DIR> [--apply]"); process.exit(2); }

/** Is this KTX2 container a ktx-create image with a LINEAR transfer? */
export function convertedLinear(b: Uint8Array): boolean {
  if (b.length < 80 || b[0] !== 0xab || b[1] !== 0x4b) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dfd = dv.getUint32(48, true), kvd = dv.getUint32(56, true), kvl = dv.getUint32(60, true);
  if (dfd + 15 > b.length) return false;
  const kv = new TextDecoder().decode(b.subarray(kvd, Math.min(b.length, kvd + kvl)));
  return b[dfd + 4 + 10] === 1 && /ktx create/.test(kv);
}

const hits: string[] = [];
for (const f of new Glob("**/*").scanSync({ cwd: root, onlyFiles: true })) {
  const path = `${root}/${f}`;
  if (f.endsWith(".ktx2")) { if (convertedLinear(new Uint8Array(readFileSync(path)))) hits.push(f); continue; }
  if (!/\.ktx2\.(glb|vrm)$|\.lod\.[^/]*\.glb$/.test(f)) continue;
  let json: any, bin: Uint8Array;
  try { ({ json, bin } = parseGlb(new Uint8Array(readFileSync(path)))); } catch { continue; }
  const bad = (json.images ?? []).some((im: any) => {
    if (im.mimeType !== "image/ktx2" || im.extras?.[KTX2_TF_MARK]) return false;
    const bv = json.bufferViews?.[im.bufferView]; if (!bv) return false;
    return convertedLinear(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  });
  if (bad) hits.push(f);
}
for (const f of hits) console.log(`  ${apply ? "deleted" : "would delete"} ${f}`);
if (apply) for (const f of hits) rmSync(`${root}/${f}`);
console.log(`${hits.length} variant(s) with converted data maps${apply ? " deleted — rotate KTX2_KEY and restart; the boot sweep rebuilds them" : " (dry run; --apply deletes)"}`);
