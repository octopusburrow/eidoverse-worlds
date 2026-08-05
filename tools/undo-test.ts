// undo — inverse-speech round trips, run headless.
//
//   bun tools/undo-test.ts
//
// Undo here is not a shadow-state rollback: every edit was a verb in the log,
// so the inverse is another verb. That makes it testable at the SENTENCE
// level — record a pair, undo, and assert the sentences that get spoken are
// the ones that restore the prior state.
//
// This exists because the inspector's steppers shipped with no undo at all
// (2026-08-05): a fat-fingered scale had no way home, and the nicer panel was
// therefore the more dangerous one. It also pins the multi-verb case — the
// inverse of deleting a thing is a spawn AND its transform AND every
// component it wore, which a single-sentence inverse silently loses.

import { plugin } from "bun";
const here = (f: string) => new URL(f, import.meta.url).pathname;
plugin({
  name: "undo-stubs",
  setup(b) {
    b.onResolve({ filter: /^\.\/net\.js$/ }, () => ({ path: here("./undo-net-stub.mjs") }));
    b.onResolve({ filter: /^\.\/ui\.js$/ }, () => ({ path: here("./undo-ui-stub.mjs") }));
  },
});

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

const net = await import("./undo-net-stub.mjs");
const { recordPair, undo, redoLast, undoDebug } = await import("../client/lib/editundo.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

// --- a single-sentence inverse round trips
net.spoken.length = 0;
recordPair({ verb: "place", args: { id: "die", scale: [1, 1, 1] } },
           { verb: "place", args: { id: "die", scale: [4, 4, 4] } });
undo();
check("undo speaks the inverse sentence",
  net.spoken.length === 1 && net.spoken[0].verb === "place" &&
  JSON.stringify(net.spoken[0].args.scale) === "[1,1,1]", JSON.stringify(net.spoken));

// --- redo re-speaks the original
net.spoken.length = 0;
redoLast();
check("redo re-speaks the edit",
  net.spoken.length === 1 && JSON.stringify(net.spoken[0].args.scale) === "[4,4,4]",
  JSON.stringify(net.spoken));

// --- undo/redo is a cycle, not a one-way trip
net.spoken.length = 0;
undo(); redoLast(); undo();
check("undo/redo cycles without losing the pair",
  net.spoken.length === 3 &&
  JSON.stringify(net.spoken.map((s: any) => s.args.scale)) === "[[1,1,1],[4,4,4],[1,1,1]]",
  JSON.stringify(net.spoken.map((s: any) => s.args.scale)));

// --- the multi-verb inverse: deleting a thing must restore ALL of it
net.spoken.length = 0;
recordPair(
  { verb: "spawn", args: { id: "urn", lib: "urn.glb", pos: [1, 0, 2], yaw: 0.5 },
    also: [
      { verb: "place", args: { id: "urn", rot: [0, 0.5, 0], scale: [2, 2, 2] } },
      { verb: "comp", args: { id: "urn", type: "grab", data: {} } },
      { verb: "comp", args: { id: "urn", type: "label", data: { text: "the urn" } } },
    ] },
  { verb: "remove", args: { id: "urn" } });
undo();
check("undoing a delete respawns the thing",
  net.spoken[0]?.verb === "spawn" && net.spoken[0].args.lib === "urn.glb",
  JSON.stringify(net.spoken[0]));
check("...and restores its transform",
  net.spoken.some((s: any) => s.verb === "place" && JSON.stringify(s.args.scale) === "[2,2,2]"),
  JSON.stringify(net.spoken.map((s: any) => s.verb)));
check("...and every component it wore",
  net.spoken.filter((s: any) => s.verb === "comp").length === 2 &&
  net.spoken.some((s: any) => s.args.type === "grab") &&
  net.spoken.some((s: any) => s.args.type === "label"),
  JSON.stringify(net.spoken.filter((s: any) => s.verb === "comp").map((s: any) => s.args.type)));
check("...in order: spawn before its trimmings",
  net.spoken[0].verb === "spawn" && net.spoken.length === 4,
  net.spoken.map((s: any) => s.verb).join(","));

// --- redoing a multi-verb undo must not replay the `also` trail as an edit
net.spoken.length = 0;
redoLast();
check("redoing a delete removes it again, once",
  net.spoken.length === 1 && net.spoken[0].verb === "remove",
  JSON.stringify(net.spoken.map((s: any) => s.verb)));

// --- an empty stack is a no-op, not a crash
net.spoken.length = 0;
while (undoDebug().undo > 0) undo();
net.spoken.length = 0;
undo();
check("undo on an empty stack speaks nothing", net.spoken.length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
