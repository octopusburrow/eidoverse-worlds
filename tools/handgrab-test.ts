// handgrab — the pick rules, run headless.
//
//   bun tools/handgrab-test.ts
//
// Tests the two rules that make small objects usable, because both are the
// kind of thing that looks right and silently isn't:
//
//   1. reach is measured from the BODY, not the camera. The classic
//      third-person bug is grabbing something four metres away because the
//      camera happened to be near it.
//   2. among candidates under the cursor, the SMALLEST wins. A raw ray makes
//      a die nearly unpickable next to a table — the table is a far easier
//      hit. Small-wins inverts that, which is what "dice and chess pieces"
//      requires.
//
// The scoring function is reimplemented here against synthetic geometry
// rather than imported, because the module needs a canvas, a world socket and
// a controller to load. That is a real limitation and it is why this file
// tests the RULES rather than the wiring; the wiring needs a live tab.

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
};

const REACH = 2.2;
type Thing = { id: string; body: number; screenOff: number; size: number; grab: boolean };

// mirrors handgrab.js: body-distance gate, then proximity-dominant score with
// a BOUNDED size nudge. The first version scored off*2 + size, which let a die
// anywhere in the cone beat a table under the cursor — this test caught it.
const CONE = 0.2;
function pick(things: Thing[]) {
  const cands = things.filter((t) => t.grab && t.body <= REACH);
  let best: { id: string; score: number } | null = null;
  for (const c of cands) {
    if (c.screenOff > CONE) continue;                // not under the pointer
    const score = c.screenOff / CONE + Math.min(1, c.size / 2) * 0.35;
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

const die   = (o = 0.01, body = 1.0) => ({ id: "die",   body, screenOff: o, size: 0.04, grab: true });
const table = (o = 0.02, body = 1.2) => ({ id: "table", body, screenOff: o, size: 1.80, grab: true });
const floor = { id: "floor", body: 0.5, screenOff: 0.0, size: 40, grab: false };

// --- the headline case: a die on a table, cursor roughly on the die
check("a die beats the table it sits on",
  pick([die(), table()]) === "die", String(pick([die(), table()])));

// --- even when the cursor is slightly closer to the table's centre
check("...even when the table is nearer the cursor centre",
  pick([die(0.05), table(0.0)]) === "die", String(pick([die(0.05), table(0.0)])));

// --- but not when the cursor is genuinely far from the die
check("...but not when the cursor is clearly on the table instead",
  pick([die(0.19), table(0.0)]) === "table", String(pick([die(0.19), table(0.0)])));

// --- the gate: ungrabbable things are never candidates, however easy to hit
check("the floor is never picked up (no grab component)",
  pick([floor]) === null, String(pick([floor])));
check("...and does not shadow a grabbable thing on top of it",
  pick([floor, die()]) === "die", String(pick([floor, die()])));

// --- reach is from the body
check("out-of-reach things are not grabbable",
  pick([die(0.01, 3.0)]) === null, String(pick([die(0.01, 3.0)])));
check("...even if they are the only thing under the cursor",
  pick([die(0.0, 9.0), table(0.15, 1.0)]) === "table",
  String(pick([die(0.0, 9.0), table(0.15, 1.0)])));
check("a thing exactly at the reach limit is still takeable",
  pick([die(0.01, REACH)]) === "die", String(pick([die(0.01, REACH)])));

// --- nothing under the cursor
check("empty air picks nothing", pick([die(0.9), table(0.8)]) === null);
check("an empty world picks nothing", pick([]) === null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
