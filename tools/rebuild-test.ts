// bun tools/rebuild-test.ts — POST /rebuild's worker (upload.ts rebuildAsset) against the real pump with a FAKE child
// (OPT_CMD, as optimize-pump-test): a refused pass is asked again (.failed cleared, the child runs, the variant
// lands); a BUILT variant is rebuilt in place (force — the pump otherwise skips a fresh variant); library layout
// (source in the library, variants in the OPT mirror) and store layout (beside the original) both resolve; anything
// that is not an original object — traversal, a variant name, a missing file, a non-GLB — is refused, with nothing
// queued. Then the route: 401 without the token, 400 on a bad path, 200 with the passes named.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d: unknown = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${n}${ok ? "" : `  ${JSON.stringify(d)}`}`); };
const root = mkdtempSync(join(tmpdir(), "rebuild-"));
const fake = join(root, "fake.sh"), receipts = join(root, "receipts.txt");
writeFileSync(fake, `#!/bin/sh
src=""; dest=""; mode=""
for a in "$@"; do case "$a" in --*) mode="$a";; *) if [ -z "$src" ]; then src="$a"; else dest="$a"; fi;; esac; done
echo "$mode $dest" >> "${receipts}"
mkdir -p "$(dirname "$dest")"; printf 'rebuilt' > "$dest"; exit 0
`); chmodSync(fake, 0o755); writeFileSync(receipts, "");
Object.assign(process.env, { SKIP_OPT_SWEEP: "1", WORLDS_DIR: join(root, "worlds"), OPT_DIR: join(root, "opt"), EIDOVERSE_DIR: join(root, "lib"),
  JOIN_TOKEN: "t0k", OPT_CMD: fake, OPT_MEM_BUDGET_MB: "0", KTX2_TOKTX: "" });
const { rebuildAsset, optIdle } = await import("../server/upload.ts");
const { ktx2VariantPath, lodVariantPath } = await import("../server/store-variants.ts");
const lib = join(root, "lib", "eidoverse/assets/models"), opt = join(root, "opt"), store = join(opt, "store");
mkdirSync(lib, { recursive: true }); mkdirSync(store, { recursive: true });
writeFileSync(join(lib, "rock.glb"), "orig"); writeFileSync(join(store, "abc123.glb"), "orig");
const runs = () => readFileSync(receipts, "utf8").split("\n").filter(Boolean);

// 1. library, refused LOD: its .failed is cleared and the pass runs; the KTX2 variant is BUILT and fresh → rebuilt too
const libK = join(opt, ktx2VariantPath("eidoverse/assets/models/rock.glb")), libL = join(opt, lodVariantPath("eidoverse/assets/models/rock.glb"));
mkdirSync(join(opt, "eidoverse/assets/models"), { recursive: true });
writeFileSync(libK, "old"); const later = new Date(Date.now() + 60_000); utimesSync(libK, later, later);   // fresher than its source
writeFileSync(`${libL}.failed`, "[optimize] lod: reduction ineffective (20000 -> 19000 verts, permissive too)");
const r1 = rebuildAsset("eidoverse/assets/models/rock.glb"); await optIdle();
check("library object: both passes queued", JSON.stringify(r1?.queued) === '["ktx2","lod"]', r1);
check("…the refused LOD's .failed is gone and the LOD landed", !existsSync(`${libL}.failed`) && readFileSync(libL, "utf8") === "rebuilt");
check("…the fresh BUILT KTX2 variant was rebuilt in place (forced)", readFileSync(libK, "utf8") === "rebuilt");
check("…variants land in the OPT mirror, the library source untouched", readFileSync(join(lib, "rock.glb"), "utf8") === "orig" && runs().length === 2, runs());

// 2. store object, deferred KTX2: .deferred cleared, both beside the original
const stK = ktx2VariantPath(join(store, "abc123.glb")), stL = lodVariantPath(join(store, "abc123.glb"));
writeFileSync(`${stK}.deferred`, "estimated 900MB > budget");
const r2 = rebuildAsset("store/abc123.glb"); await optIdle();
check("store object: variants rebuilt beside the original, .deferred cleared", !!r2 && readFileSync(stK, "utf8") === "rebuilt" && readFileSync(stL, "utf8") === "rebuilt" && !existsSync(`${stK}.deferred`));

// 3. refusals: nothing queued for any of them
const before = runs().length;
const bad = ["../../etc/passwd.glb", "eidoverse/assets/models/../../x.glb", "store/abc123.glb.ktx2.glb", `store/abc123.glb.lod.x.glb`,
  "eidoverse/assets/models/missing.glb", "eidoverse/assets/vrms/a.vrm", "store/abc123.png", "", "eidoverse/assets/models/sub/rock.glb"];
for (const b of bad) check(`refused: ${JSON.stringify(b)}`, rebuildAsset(b) === null);
await optIdle();
check("…and no refused path ran the optimizer", runs().length === before, runs().slice(before));

// 4. the route, gated like POST /thumb
const { route } = await import("../server/routes.ts");
const call = async (q: string) => await route(new Request(`http://x/rebuild?${q}`, { method: "POST" }), {} as any);
const noTok = await call("path=store/abc123.glb");
check("route: no token → 401", noTok.status === 401, noTok.status);
const wrongTok = await call("token=nope&path=store/abc123.glb");
check("route: wrong token → 401", wrongTok.status === 401, wrongTok.status);
const badPath = await call("token=t0k&path=store/..%2F..%2Fx.glb");
check("route: bad path → 400", badPath.status === 400, badPath.status);
const good = await call("token=t0k&path=store/abc123.glb");
const j = good.status === 200 ? await good.json() : null;
check("route: token + object → 200 naming the passes", j?.ok === true && j.queued.join() === "ktx2,lod", [good.status, j]);
await optIdle();
console.log(`${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m`); process.exit(fail ? 1 : 0);
