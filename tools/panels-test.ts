// panels — the schema factory's desktop renderer, run headless.
//
//   bun tools/panels-test.ts
//
// What this binds: (1) typed entry with Maya's relative operators; (2) the
// shape key that decides in-place update vs rebuild; (3) that a same-shape
// repaint keeps the SAME nodes and lands the new value; (4) drag-to-scrub is
// absolute-from-origin (Godot's spinner: start + step × distance, never
// accumulated) with a live preview per move and ONE commit on release; (5) Esc
// mid-drag restores the start value and commits nothing; (6) a click that
// travelled never fires a row button (nav/action separation).

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

// happy-dom has no pointer capture; model it on elements (see frames-resize-test)
(Element.prototype as any).setPointerCapture = function (id: number) { (this as any).__cap = id; };
(Element.prototype as any).releasePointerCapture = function (id: number) { (this as any).__cap = undefined; };

const { parseEntry, shapeKey, renderDOM, makeSchemaFrame } = await import("../client/lib/panels.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("\nparseEntry — relative math:");
check("plain number", parseEntry("3.5", 0) === 3.5);
check("+=2 from 5 → 7", parseEntry("+=2", 5) === 7);
check("-=.5 from 5 → 4.5", parseEntry("-=.5", 5) === 4.5);
check("*=-1 mirrors", parseEntry("*=-1", 5) === -5);
check("/=2 halves", parseEntry("/=2", 5) === 2.5);
check("+=10% from 50 → 55", near(parseEntry("+=10%", 50)!, 55));
check("/=0 is refused", parseEntry("/=0", 5) === null);
check("garbage is refused", parseEntry("abc", 5) === null);

console.log("\nshapeKey — what counts as the same shape:");
const A = [{ t: "num", k: "x", label: "x", value: 1 }, { t: "group", k: "g", label: "G", open: true }, { t: "check", k: "c", value: true }];
const B = [{ t: "num", k: "x", label: "x!", value: 99 }, { t: "group", k: "g", label: "G", open: true }, { t: "check", k: "c", value: false }];
const C = [{ t: "num", k: "x", label: "x", value: 1 }, { t: "group", k: "g", label: "G", open: false }, { t: "check", k: "c", value: true }];
check("values and labels are not shape", shapeKey(A) === shapeKey(B));
check("a fold IS shape", shapeKey(A) !== shapeKey(C));
check("disabled IS shape", shapeKey(A) !== shapeKey([{ ...A[0], disabled: true }, A[1], A[2]]));

console.log("\nin-place update — same shape keeps the same nodes:");
{
  const sf = makeSchemaFrame("t-insp", { title: "t", x: 10, y: 10, w: 300, h: 200 });
  const calls: any[] = [];
  const edit = (...a: any[]) => calls.push(a);
  sf.set(A, edit);
  const body = sf.frame.body.querySelector(".schema-scroll")!;
  const num1 = body.querySelector(".sp-num") as HTMLInputElement;
  const chk1 = body.querySelector("input[type=checkbox]") as HTMLInputElement;
  check("first paint renders the number", num1?.value === "1.00", num1?.value);
  sf.set(B, edit);
  const num2 = body.querySelector(".sp-num") as HTMLInputElement;
  check("same-shape repaint keeps the SAME input node", num2 === num1);
  check("…and lands the new value", num2.value === "99.00", num2.value);
  check("…and the new label", body.querySelector(".sp-label")?.textContent === "x!");
  check("…and the checkbox state", (body.querySelector("input[type=checkbox]") as HTMLInputElement) === chk1 && chk1.checked === false);
  sf.set(C, edit);
  check("a fold change rebuilds (rows under a closed group vanish)", body.querySelector("input[type=checkbox]") === null);
}

console.log("\ntyped entry commits ONE value, on the wire scale:");
{
  const host = document.createElement("div");
  const calls: any[] = [];
  renderDOM(host, [{ t: "num", k: "yaw", value: Math.PI / 2, step: 5, deg: true }], (...a: any[]) => calls.push(a));
  const inp = host.querySelector(".sp-num") as HTMLInputElement;
  check("deg field shows degrees on the face", inp.value === "90", inp.value);
  inp.value = "+=45"; inp.dispatchEvent(new Event("change"));
  check("one commit", calls.length === 1, String(calls.length));
  check("…in radians (135°)", calls[0] && near(calls[0][1], Math.PI * 0.75), JSON.stringify(calls[0]));
  check("…with no live flag", calls[0] && !calls[0][3]?.live);
  inp.value = "nonsense"; inp.dispatchEvent(new Event("change"));
  check("garbage restores the face and commits nothing", inp.value === "135" && calls.length === 1, `${inp.value} / ${calls.length}`);
}

const pe = (type: string, x: number, extra: any = {}) =>
  new (globalThis as any).PointerEvent(type, { clientX: x, clientY: 0, button: 0, pointerId: 1, bubbles: true, ...extra });

console.log("\ndrag-to-scrub — absolute from origin, live then one commit:");
{
  const host = document.createElement("div");
  const calls: any[] = [];
  renderDOM(host, [{ t: "num", k: "px", value: 2, step: 0.1, dp: 2 }], (...a: any[]) => calls.push(a));
  const inp = host.querySelector(".sp-num") as HTMLInputElement;
  inp.dispatchEvent(pe("pointerdown", 100));
  inp.dispatchEvent(pe("pointermove", 102));
  check("under the 4px slop nothing happens", calls.length === 0);
  inp.dispatchEvent(pe("pointermove", 150));
  inp.dispatchEvent(pe("pointermove", 200));
  inp.dispatchEvent(pe("pointermove", 150));   // wander back
  const lives = calls.filter((c) => c[3]?.live);
  check("every move previews live", lives.length === 3, String(lives.length));
  // perPx = step*0.2 = 0.02 → +50px = +1.00; the wander back lands EXACTLY on it
  check("value is start + step×distance (not accumulated)", near(lives[2][1], 3, 1e-9), String(lives[2][1]));
  check("the face tracks the drag", inp.value === "3.00", inp.value);
  inp.dispatchEvent(pe("pointerup", 150));
  const finals = calls.filter((c) => !c[3]?.live);
  check("release commits exactly once", finals.length === 1, String(finals.length));
  check("…with the final value", finals[0] && near(finals[0][1], 3, 1e-9));
}

console.log("\nEsc mid-drag restores the start and commits nothing:");
{
  const host = document.createElement("div");
  const calls: any[] = [];
  renderDOM(host, [{ t: "num", k: "px", value: 2, step: 0.1, dp: 2 }], (...a: any[]) => calls.push(a));
  const inp = host.querySelector(".sp-num") as HTMLInputElement;
  inp.dispatchEvent(pe("pointerdown", 100));
  inp.dispatchEvent(pe("pointermove", 160));
  check("previewed away from start", inp.value === "3.20", inp.value);
  inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const last = calls[calls.length - 1];
  check("face restored", inp.value === "2.00", inp.value);
  check("a live restore was dispatched (the preview must snap back)", last[3]?.live && near(last[1], 2));
  inp.dispatchEvent(pe("pointerup", 160));
  check("no commit after Esc", calls.every((c) => c[3]?.live));
}

console.log("\nshift = fine, ctrl = snap, soft limit bounds the drag, hard bounds typing:");
{
  const host = document.createElement("div");
  const calls: any[] = [];
  renderDOM(host, [{ t: "num", k: "b", value: 10, step: 1, dp: 0, min: 0, softMax: 20 }], (...a: any[]) => calls.push(a));
  const inp = host.querySelector(".sp-num") as HTMLInputElement;
  inp.dispatchEvent(pe("pointerdown", 0));
  inp.dispatchEvent(pe("pointermove", 500));          // +100 nominal → soft-capped
  check("drag stops at the soft max", inp.value === "20", inp.value);
  inp.dispatchEvent(pe("pointerup", 500));
  inp.value = "50"; inp.dispatchEvent(new Event("change"));
  check("typing exceeds the soft max", inp.value === "50", inp.value);
  inp.value = "-5"; inp.dispatchEvent(new Event("change"));
  check("…but not the hard min", inp.value === "0", inp.value);
}

console.log("\nnav/action separation — a click that travelled fires nothing:");
{
  const sf = makeSchemaFrame("t-guard", { title: "t", x: 10, y: 10, w: 300, h: 200 });
  const calls: any[] = [];
  sf.set([{ t: "btn", k: "boom", label: "remove", danger: true }], (...a: any[]) => calls.push(a));
  const scroll = sf.frame.body.querySelector(".schema-scroll")!;
  const btn = scroll.querySelector(".sp-btn") as HTMLButtonElement;
  btn.dispatchEvent(pe("pointerdown", 100));
  btn.dispatchEvent(new (globalThis as any).MouseEvent("click", { clientX: 130, clientY: 0, bubbles: true }));
  check("moved 30px → the button did NOT fire", calls.length === 0, String(calls.length));
  btn.dispatchEvent(pe("pointerdown", 100));
  btn.dispatchEvent(new (globalThis as any).MouseEvent("click", { clientX: 101, clientY: 0, bubbles: true }));
  check("a still click fires", calls.length === 1 && calls[0][0] === "boom", String(calls.length));
}

console.log("\ndisabled and driven:");
{
  const host = document.createElement("div");
  const calls: any[] = [];
  renderDOM(host, [{ t: "num", k: "x", value: 1, disabled: true }, { t: "num", k: "y", value: 1, driven: "motion" }], (...a: any[]) => calls.push(a));
  const [dis, drv] = [...host.querySelectorAll(".sp-num")] as HTMLInputElement[];
  dis.dispatchEvent(pe("pointerdown", 0)); dis.dispatchEvent(pe("pointermove", 100)); dis.dispatchEvent(pe("pointerup", 100));
  check("a disabled number ignores the drag", calls.length === 0 && dis.disabled);
  check("a driven row is tinted and titled", drv.closest(".sp-row")!.classList.contains("driven") && /motion/.test((drv.closest(".sp-row") as HTMLElement).title));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
