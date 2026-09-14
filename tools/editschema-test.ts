// editschema — the ONE declaration three surfaces read, proven pure.
//
//   bun tools/editschema-test.ts
//
// Binds: the schema is a function of the folded record (a light, a model, a
// mounted thing, a driven thing, unknown comps); channels() flattens every
// num with a dotted address; editVerbs turns dotted edits into the FEWEST
// verbs (three transform channels = one full-pose place; two socket fields =
// one merged comp), honours relative math on the face scale (degrees), hard
// limits, read-only fields, and never mutates the record it reads.

import { inspectSchema, channels, editVerbs, describeSchema, fieldAt, parseEntry } from "../shared/editschema.js";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const one = (r: any, verb: string) => r.verbs.filter((v: any) => v.verb === verb);

const chair = { lib: "furniture/chair.glb", pos: [1, 0, 2], yaw: 1.5708, actor: "r", ts: 1,
  comp: { sockets: { seat: { pos: [0, 0.5, 0], yaw: 0 }, side: { pos: [0.4, 0.5, 0], yaw: 1 } }, recipe: { wood: 2 }, lock: true } };
const lamp = { kind: "light", pos: [0, 2, 0], color: 0xff8800, intensity: 20, range: 6, keep: true, actor: "r", ts: 1 };
const swing = { lib: "swing.glb", pos: [5, 0, 5], yaw: 0, actor: "r", ts: 1, comp: { motion: { type: "pendulum", axis: [1, 0, 0], amp: 0.4, period: 3, t0: 123 }, "motion:plank": { type: "spin", rpm: 10 } } };
const cargo = { lib: "crate.glb", pos: [9, 9, 9], yaw: 0, actor: "r", ts: 1, parent: { to: "truck", offset: [0, 1, 0] } };

console.log("\nschema is a function of the record:");
{
  const s = inspectSchema(chair, "c1");
  const G = s.groups.map((g) => g.group);
  check("a chair: pos · flags · sockets · comp", JSON.stringify(G) === '["pos","flags","sockets","comp"]', JSON.stringify(G));
  check("locked → transform read-only with the reason", fieldAt(s, "pos.x")!.disabled === true && /locked/.test(fieldAt(s, "pos.x")!.hint));
  check("unknown comp 'recipe' is a raw-JSON text field; sockets/lock are NOT duplicated there", fieldAt(s, "comp.recipe")?.t === "text" && !fieldAt(s, "comp.sockets") && !fieldAt(s, "comp.lock"));
  check("sockets: a list + per-slot channels", fieldAt(s, "sockets.slots")?.t === "list" && fieldAt(s, "sockets.side|yaw")?.value === 1);
  const l = inspectSchema(lamp, "L");
  check("a light: no yaw/scale, a light group from the fold's values", !fieldAt(l, "pos.yaw") && fieldAt(l, "light.intensity")?.value === 20 && fieldAt(l, "light.keep")?.value === true);
  const w = inspectSchema(swing, "s");
  check("a driven thing: transform tinted, rest pose", fieldAt(w, "pos.x")!.driven === "motion" && fieldAt(w, "pos.x")!.value === 5);
  check("motion group covers the whole comp AND the part", fieldAt(w, "motion.amp")?.t === "num" && fieldAt(w, "motion.plank|degPerSec")?.value === 60);
  check("axis vector reads back as a name", fieldAt(w, "motion.axis")?.value === "x");
  const m = inspectSchema(cargo, "k");
  check("mounted → transform read-only, names the carrier", fieldAt(m, "pos.x")!.disabled && /truck/.test(fieldAt(m, "pos.x")!.hint));
  check("null record → empty", inspectSchema(null, "zz").groups.length === 0);
  const ch = channels(w);
  check("channels(): every num, dotted", ch.length >= 8 && ch.every((c) => c.t === "num" && c.key.includes(".")) && ch.some((c) => c.key === "motion.period"));
}

console.log("\nedits → the fewest verbs:");
{
  const r = editVerbs({ ...chair, comp: { ...chair.comp, lock: undefined } }, "c1", { "pos.x": "+=1", "pos.z": 4, "pos.yaw": "90" });
  const p = one(r, "place");
  check("three transform edits = ONE place with the full pose", p.length === 1 && r.verbs.length === 1, JSON.stringify(r));
  check("…x relative, z absolute, yaw typed in degrees → radians", p[0] && p[0].args.pos[0] === 2 && p[0].args.pos[2] === 4 && near(p[0].args.yaw, Math.PI / 2, 1e-4), JSON.stringify(p[0]?.args));
  check("…scale carried unchanged", p[0]?.args.scale === 1);
  const rl = editVerbs(chair, "c1", { "pos.x": 3 });
  check("locked refuses with the reason, sends nothing", rl.verbs.length === 0 && /locked/.test(rl.errors[0] ?? ""));
  const rs = editVerbs(chair, "c1", { "sockets.seat|pos|1": "+=0.1", "sockets.side|yaw": "*=2" });
  const cs = one(rs, "comp");
  check("two socket edits = ONE merged sockets comp keeping the other slot", cs.length === 1 && cs[0].args.type === "sockets" && near(cs[0].args.data.seat.pos[1], 0.6) && near(cs[0].args.data.side.yaw, 2) && cs[0].args.data.side.pos[0] === 0.4, JSON.stringify(cs));
  const rd = editVerbs(chair, "c1", { "sockets.del": "seat" });
  check("del keeps the rest", one(rd, "comp")[0].args.data.seat === undefined && one(rd, "comp")[0].args.data.side);
  const rd2 = editVerbs({ ...chair, comp: { sockets: { seat: { pos: [0, 0.5, 0] } } } }, "c1", { "sockets.del": "seat" });
  check("deleting the last slot removes the comp (data null)", one(rd2, "comp")[0].args.data === null);
  const rL = editVerbs(lamp, "L", { "light.intensity": "-=10%", "light.noon": true, "light.color": "#00ff00" });
  const lv = one(rL, "light");
  check("light edits = ONE partial light: intensity 18, day:false, color parsed", lv.length === 1 && lv[0].args.intensity === 18 && lv[0].args.day === false && lv[0].args.color === 0x00ff00 && lv[0].args.range === undefined, JSON.stringify(lv));
  const rM = editVerbs(swing, "s", { "motion.amp": "+=10", "motion.plank|degPerSec": 90 });
  const mv = one(rM, "motion"), cv = one(rM, "comp");
  check("whole motion → motion verb keeping t0; part → comp motion:plank; rpm retired", mv.length === 1 && mv[0].args.t0 === 123 && near(mv[0].args.amp, 0.4 + 10 / 180 * Math.PI, 1e-4) && cv.length === 1 && cv[0].args.type === "motion:plank" && cv[0].args.data.degPerSec === 90 && cv[0].args.data.rpm === undefined, JSON.stringify(rM));
  const rR = editVerbs(swing, "s", { "motion.rest": 1 });
  check("rest → {type:null}", one(rR, "motion")[0].args.type === null);
  const rF = editVerbs(swing, "s", { "flags.label": "  the swing ", "flags.hidden": "yes", "comp.+": "notice", "comp.nope": "{bad json" });
  check("label trimmed, hidden as comp true, + adds an empty comp, bad JSON reported", one(rF, "comp").some((v) => v.args.type === "label" && v.args.data === "the swing") && one(rF, "comp").some((v) => v.args.type === "hidden" && v.args.data === true) && one(rF, "comp").some((v) => v.args.type === "notice") && rF.errors.some((e) => /comp\.nope/.test(e)), JSON.stringify(rF));
  check("hard min clamps (scale 0.01)", one(editVerbs({ ...chair, comp: {} }, "c1", { "pos.scale": -3 }), "place")[0].args.scale === 0.01);
  check("an unknown field is an error, not a verb", editVerbs(chair, "c1", { "light.intensity": 3 }).errors.length === 1);
  check("a viewport gesture (sockets.add) is refused with guidance", /gesture/.test(editVerbs(chair, "c1", { "sockets.add": 1 }).errors[0] ?? ""));
  const before = JSON.stringify(chair);
  editVerbs(chair, "c1", { "sockets.seat|pos|0": 9, "flags.lock": false, "comp.recipe": "{\"wood\":3}" });
  check("editVerbs never mutates the record", JSON.stringify(chair) === before);
}

console.log("\ndescribeSchema reads like an inspector:");
{
  const t = describeSchema(inspectSchema(lamp, "L"));
  check("names dotted addresses with values and units", /light\.intensity = 20/.test(t) && /light\.range = 6 m/.test(t) && /pos\.y = 2 m/.test(t));
  check("says how to edit", /edit \{id, set:/.test(t));
  const t2 = describeSchema(inspectSchema(cargo, "k"));
  check("read-only fields say why", /read-only: mounted on truck/.test(t2));
  check("parseEntry passes numbers and refuses garbage", parseEntry(4, 0) === 4 && parseEntry("x", 0) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
