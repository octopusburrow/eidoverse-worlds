// bun tools/lod-gate-test.ts — the LOD is judged by GPU cost, not file bytes (optimize.ts --lod; R 09-24).
// Runs the REAL CLI (real KTX2 encoder) on a textured store model the old byte gate refused (its KTX2 textures are
// bigger on disk than the JPEG original). Asserts: exit 0, a variant written, vertices ≤ 0.6×, GPU texture memory
// lower, and the download ratio reported. No fixture or no encoder → FAIL, never a silent pass.
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { glbPerf } from "../server/glbperf.ts";
import { findKtx2Encoder } from "../server/optimize.ts";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, got: unknown) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗"} ${n}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const FIX = process.env.LOD_GATE_FIXTURE ?? "/home/claude/eido/staging/assets/opt/store/1550fd3faa4673f9.glb";
check("fixture present (a textured store model the byte gate refused)", existsSync(FIX), FIX);
check("a KTX2 encoder on this host", !!findKtx2Encoder(), null);
if (existsSync(FIX) && findKtx2Encoder()) {
  const out = join(mkdtempSync(join(tmpdir(), "lodgate-")), "out.glb");
  const p = Bun.spawnSync(["bun", "server/optimize.ts", "--lod", FIX, out], { stdout: "pipe", stderr: "pipe" });
  const log = p.stdout.toString() + p.stderr.toString();
  check("the CLI exits 0 (not refused)", p.exitCode === 0, log.slice(-300));
  if (existsSync(out)) {
    const a = glbPerf(new Uint8Array(readFileSync(FIX))), b = glbPerf(new Uint8Array(readFileSync(out)));
    check("vertices/tris cut to ≤ 0.6×", b.tris <= a.tris * 0.6, [a.tris, b.tris]);
    check("GPU texture memory lower than the original's", b.texMB < a.texMB, [a.texMB, b.texMB]);
    check("the file is bigger on disk (the case the old gate refused)", statSync(out).size > statSync(FIX).size * 1.25, [statSync(FIX).size, statSync(out).size]);
    check("the download ratio is reported", /download [\d.]+x the original/.test(log), log.match(/download.*$/m)?.[0]);
  } else check("variant written", false, log.slice(-300));
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
