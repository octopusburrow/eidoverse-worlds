// schema panels — the field renderer and dispatchers, run headless.
//
//   bun tools/panels-test.ts
//
// Pins the panel contract: fields render, steppers dispatch absolute values,
// list actions dispatch (action, rowId), and the same field list feeds the
// canvas renderer's region math (regions must exist for every interactive
// field — a region the canvas forgot is a button VR can't press).

import { plugin } from "bun";
const here = (f: string) => new URL(f, import.meta.url).pathname;
plugin({
  name: "panel-stubs",   // frames.js pulls core.js pulls a WebGPURenderer; not headless food
  setup(b) {
    b.onResolve({ filter: /^\.\/frames\.js$/ }, () => ({ path: here("./panels-frames-stub.mjs") }));
  },
});

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

const { renderDOM, renderCanvas, hitRegion } = await import("../client/lib/panels.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const FIELDS = [
  { t: "info", label: "thing", value: "die-a1b2" },
  { t: "num", k: "scale", label: "scale", value: 1.5, step: 0.1, dp: 2 },
  { t: "vec3", k: "pos", label: "position", value: [1, 2, 3], step: 0.1, dp: 2 },
  { t: "btn", k: "grab", label: "make grabbable" },
  { t: "list", label: "aboard", rows: [
    { id: "die-a1b2", label: "die", actions: [{ k: "delete", label: "del", danger: true }] },
  ]},
];

// ---- DOM renderer
const calls: any[] = [];
const body = document.createElement("div");
renderDOM(body, FIELDS, (k: string, v: any) => calls.push([k, v]));

check("every field renders a row", body.querySelectorAll(".sp-row").length === 5,
  String(body.querySelectorAll(".sp-row").length));

(body.querySelector(".sp-f-num .sp-bump") as any).click();   // minus on scale
check("num stepper dispatches an absolute value",
  calls.length === 1 && calls[0][0] === "scale" && Math.abs(calls[0][1] - 1.4) < 1e-9,
  JSON.stringify(calls));

const vecBumps = body.querySelectorAll(".sp-vec .sp-bump");
(vecBumps[1] as any).click();      // plus on X
check("vec3 stepper dispatches the whole vector",
  JSON.stringify(calls[1]) === JSON.stringify(["pos", [1.1, 2, 3]]), JSON.stringify(calls[1]));

(body.querySelector(".sp-btn") as any).click();
check("button dispatches its key", calls[2]?.[0] === "grab", JSON.stringify(calls[2]));

(body.querySelector(".sp-mini") as any).click();
check("list action dispatches (action, rowId)",
  JSON.stringify(calls[3]) === JSON.stringify(["delete", "die-a1b2"]), JSON.stringify(calls[3]));

(body.querySelector(".sp-item-main") as any).click();
check("row click dispatches ('row', rowId)",
  JSON.stringify(calls[4]) === JSON.stringify(["row", "die-a1b2"]), JSON.stringify(calls[4]));

// ---- canvas renderer regions (happy-dom has no 2d context; stub enough to
// exercise the LAYOUT math, which is what VR depends on)
const canvas: any = document.createElement("canvas");
const noop = () => {};
canvas.getContext = () => new Proxy({}, { get: (_, p) => (p === "font" ? "" : noop), set: () => true });
const regions = renderCanvas(canvas, FIELDS, { width: 512 });

check("canvas regions cover every interactive surface",
  // num: 2 bumps; vec3: 6; btn: 1; list row: 1 + 1 action = 2  → 11
  regions.length === 11, `${regions.length} regions`);
check("a region hit resolves through UV math", (() => {
  const r = regions.find((x: any) => x.action === "grab");
  const u = (r.x + r.w / 2) / canvas.width, v = (r.y + r.h / 2) / canvas.height;
  return hitRegion(regions, canvas, u, v)?.action === "grab";
})());

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
