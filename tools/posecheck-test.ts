// bun tools/posecheck-test.ts — the pose fence (server/posecheck.ts)
import { sanePose } from "../server/posecheck.ts";
const ok = (v: unknown, why: string) => { if (!v) { console.error("FAIL", why); process.exit(1); } };
const good = { p: [1, 0, 2], yaw: 0.3, speed: 0, clip: "idle", pitch: 0 };
ok(sanePose(good) === good, "a finite pose passes through untouched");
ok(sanePose({ ...good, p: [NaN, 0, 2] }) === null, "NaN position dropped");
ok(sanePose({ ...good, yaw: NaN }) === null, "NaN yaw dropped");
ok(sanePose({ ...good, yaw: Infinity }) === null, "Infinity yaw dropped");
ok(sanePose({ ...good, p: [1, 0] }) === null, "short position dropped");
ok(sanePose({ ...good, p: ["1", 0, 2] }) === null, "string position dropped");
ok(sanePose(null) === null && sanePose("x") === null, "non-object dropped");
ok(sanePose({ p: [0, 0, 0] }) !== null, "minimal pose (no yaw) passes");
const xr = { h: [0, 0, 0, 1], r: [0.1, 1.1, 0.3, 0, 0, 0, 1], c: [0, 0, 1, 0] };
ok(sanePose({ ...good, xr }) !== null, "C18 xr passes");
ok(sanePose({ ...good, xr: { ...xr, h: [NaN, 0, 0, 1] } }) === null, "NaN head quat dropped");
ok(sanePose({ ...good, xr: { ...xr, r: [0, 1, 2] } }) === null, "short grip dropped");
ok(sanePose({ ...good, xr: { h: [0, 0, 0, 1] } }) !== null, "xr with head only passes");
ok(sanePose({ ...good, xr: null }) === null, "null xr dropped");
console.log("posecheck: 13 ok");
