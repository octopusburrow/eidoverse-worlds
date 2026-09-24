// bun tools/variant-status-test.ts — store-variants.ts variantStatus/classifyVariant: every optimization's state for a
// person, read from what the sweep left on disk (R, 09-24: nothing may fail silently). Marker lines are the CLI's own.
import { classifyVariant, variantStatus, lodVariantPath, ktx2VariantPath, LOD_RECIPE, KTX2_RECIPE } from "../server/store-variants.ts";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got: unknown) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const fs = (files: Record<string, string>) => ({ exists: (p: string) => p in files, read: (p: string) => files[p] ?? "" });

const O = "/opt/store/abc.glb", L = lodVariantPath(O), K = ktx2VariantPath(O);
const cases: [string, Record<string, string>, string, string | null][] = [
  ["variant on disk → built", { [L]: "" }, "built", null],
  ["too light → not-needed", { [`${L}.failed`]: "[optimize] lod: already light (9273 verts < 12000) (12ms) — original stays the only representation" }, "not-needed", "already light (9273 verts < 12000)"],
  ["skins → unsupported, reason without the prefix", { [`${L}.failed`]: "[optimize] lod: unsupported: skinned/avatar asset (skins) (3ms) — original stays the only representation" }, "unsupported", "skinned/avatar asset (skins)"],
  ["ineffective → refused with its numbers", { [`${L}.failed`]: "[optimize] lod: reduction ineffective (20280 -> 13728 verts) (287ms) — original stays the only representation" }, "refused", "reduction ineffective (20280 -> 13728 verts)"],
  ["size gate, current recipe → refused, no log dressing", { [`${L}.failed`]: `[optimize] not smaller (392760 -> 1634752, 17465ms) recipe=${LOD_RECIPE} — keeping original` }, "refused", "not smaller (392760 -> 1634752)"],
  ["size gate, OLD recipe → stale (the sweep re-measures)", { [`${L}.failed`]: "[optimize] not smaller (1 -> 2, 5ms) recipe=lod0-old — keeping original" }, "stale", "not smaller (1 -> 2)"],
  ["host could not afford → deferred with why", { [`${L}.deferred`]: "no ktx encoder on this host\n" }, "deferred", "no ktx encoder on this host"],
  ["nothing on disk → pending", {}, "pending", null],
  ["empty marker → refused, never a blank reason", { [`${L}.failed`]: "" }, "refused", "refused (no reason recorded)"],
];
for (const [name, files, state, reason] of cases) {
  const { exists, read } = fs(files);
  const r = classifyVariant(L, exists, read, LOD_RECIPE);
  check(name, r.state === state && r.reason === reason, r);
}
// the three variants resolve their OWN paths and recipes
{
  const { exists, read } = fs({ [K]: "", "/opt/min/abc.glb.failed": "[optimize] not smaller (10 -> 12, 1ms) — keeping original",
    [`${L}.failed`]: `[optimize] not smaller (10 -> 40, 1ms) recipe=${KTX2_RECIPE} — keeping original` });
  const v = variantStatus(O, "/opt/min", exists, read);
  check("variantStatus: ktx2 built, min refused (unstamped min verdicts stand), lod stamped with the KTX2 recipe → stale", v.ktx2.state === "built" && v.min.state === "refused" && v.lod.state === "stale", v);
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
