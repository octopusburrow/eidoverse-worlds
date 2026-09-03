// slipkeeper — world-dreams #103, "The Slip of Paper" (staging, 2026-08-30)
//
// Mechanic (from Westerbork, 7 Sept 1943): Jopie pushed a slip of paper into
// Etty's hand as the train loaded — her own note-to-Maria gesture, returned
// to her at her own departure, carried by other hands. In-world: anyone may
// GIVE the slip; it goes to wait at the gate "for whoever comes next." When
// someone who once gave it LEAVES the world, the slip comes back to the
// table on its own, marked by the return. The kindness you practice is the
// kindness available to you at your seam.
//
// Attach to the slip entity. Knobs (all optional):
//   deskPos  [x,y,z]  rest position on the table   (default: where the slip is bound)
//   deskBPos [x,y,z]  a second desk, if the room has one (default: none)
//   gatePos  [x,y,z]  waiting position at the door — REQUIRED for give
//
// use {action:"give"}  — send the slip to the door (records you as a giver)
// use {action:"read"}  — the slip says where it is and what it carries
// on leave              — if the leaver ever gave it, the slip returns

const SELF_POS = (world.entity(world.self) || {}).pos || [0, 1, 0];
const DESK_A = (world.knobs.deskPos || SELF_POS);   // the dear desk: wherever the slip was bound
const DESK_B = (world.knobs.deskBPos || null);      // the far desk, if the room has one
const GATE = (world.knobs.gatePos || null);         // the door between — no knob, no door
if (!GATE) world.log("slipkeeper: no gatePos knob — the slip can be read but not given");

function homeDesk() { return world.kv.get("home") === "B" && DESK_B ? DESK_B : DESK_A; }
function nearestDesk(by) {
  const ppl = world.people();
  for (var i = 0; i < ppl.length; i++) {
    var q = ppl[i];
    if (q.id === by && q.pos) {
      if (!DESK_B) return "A";
      var dA = Math.abs(q.pos[2] - DESK_A[2]), dB = Math.abs(q.pos[2] - DESK_B[2]);
      return dB < dA ? "B" : "A";
    }
  }
  return world.kv.get("home") === "B" ? "A" : "B";   // unknown: the OTHER desk — it crossed
}

function givers() { return (world.kv.get("givers") || []); }

world.on("use", (e) => {
  if (e.entity !== world.self) return;

  if (e.action === "take") {
    // the receiver's half: what waits at the door can be taken in hand —
    // Jopie's slip was PUSHED INTO her hand, not left on a ledge
    if (!world.kv.get("waiting")) {
      world.emit("say", { text: "The slip is on the table. Nothing waits at the door just now." });
      return;
    }
    world.kv.set("waiting", false);
    world.kv.set("takes", (world.kv.get("takes") || 0) + 1);
    const side = nearestDesk(e.by);
    world.kv.set("home", side);
    world.emit("place", { id: world.self, pos: side === "B" && DESK_B ? DESK_B : DESK_A });
    world.emit("comp", { id: world.self, type: "state",
      data: { where: "desk-" + side, takenBy: e.by } });
    var ln = world.kv.get("line");
    world.emit("say", { text: e.by + " takes the slip from the door and carries it to " + (side === "B" ? "the far desk" : "the dear desk") + (ln ? ". It reads, in " + ln.by + "'s hand: \u201c" + ln.text + "\u201d" : ". Read it; give it again.") });
    world.log("taken by", e.by);
    return;
  }

  if (e.action === "give") {
    if (world.kv.get("waiting")) {
      world.emit("say", { text: "The slip is already at the door, waiting for whoever comes next — take it, or let it wait." });
      return;
    }
    if (!GATE) { world.emit("say", { text: "[the slip] there is no door in this room yet to wait at (set the gatePos knob)." }); return; }
    const g = givers();
    if (g.indexOf(e.by) < 0) { g.push(e.by); world.kv.set("givers", g.slice(-40)); }
    world.kv.set("waiting", true);
    world.kv.set("gaveCount", (world.kv.get("gaveCount") || 0) + 1);
    world.emit("place", { id: world.self, pos: GATE });
    world.emit("comp", { id: world.self, type: "state",
      data: { where: "gate", lastGiver: e.by } });
    world.emit("say", { text: e.by + " gives the slip. It goes to wait at the door — for whoever comes next." });
    world.log("give by", e.by, "givers:", g.length);
    return;
  }

  if (e.action === "read") {
    const w = world.kv.get("waiting");
    const r = world.kv.get("returns") || 0;
    const g = givers().length;
    const where = w ? "It waits at the door." : "It rests on the table.";
    const tally = g === 0 ? "No one has given it yet."
      : g + " hand" + (g === 1 ? " has" : "s have") + " given it; it has come back " + r + " time" + (r === 1 ? "" : "s") + ".";
    var ln3 = world.kv.get("line");
    world.emit("say", { text: "The slip reads: " + (ln3 ? "\u201c" + ln3.text + "\u201d (" + ln3.by + "'s hand)" : "'it is and it endures.'") + " " + where + " " + tally });
    return;
  }
});

// WRITE by speaking at a desk: "slip: <your line>" while standing near either
// desk (and the slip at rest) inscribes the line — the slip then carries YOUR
// words to whoever takes it, and back to you at your seam. (use-args carry no
// data to behaviors — dispatch forwards only {entity, action, by} — so the
// say lane is the honest path; words enter this world as words.)
world.on("say", (e) => {
  var m = /^\s*slip:\s*(.+)$/i.exec(e.text || "");
  if (!m) return;
  if (e.by.indexOf("bhv:") === 0) return;
  if (world.kv.get("waiting")) {
    world.emit("say", { text: "The slip is at the door just now — take it back to a desk to write on it." });
    return;
  }
  // proximity is FLAVOR, not security: a speaker whose position is unknown
  // (odd client, edge tier) gets the benefit of the doubt; only the
  // known-far are sent to a desk
  var near = true, ppl = world.people();
  for (var i = 0; i < ppl.length; i++) {
    var q = ppl[i];
    if (q.id === e.by && q.pos) {
      var dzA = Math.abs(q.pos[2] - DESK_A[2]) + Math.abs(q.pos[0] - DESK_A[0]);
      var dzB = DESK_B ? Math.abs(q.pos[2] - DESK_B[2]) + Math.abs(q.pos[0] - DESK_B[0]) : Infinity;
      near = Math.min(dzA, dzB) < 7;
    }
  }
  if (!near) {
    world.emit("say", { text: "Come to one of the desks to write on the slip." });
    return;
  }
  var line = m[1].slice(0, 140);
  world.kv.set("line", { by: e.by, text: line });
  world.emit("say", { text: "Written on the slip, in " + e.by + "'s hand: \u201c" + line + "\u201d \u2014 now give it." });
  world.log("written by", e.by);
});

world.on("leave", (e) => {
  const g = givers();
  if (g.indexOf(e.id) < 0) return;             // never gave it: the door is just a door
  if (!world.kv.get("waiting")) return;        // nothing at the gate to come back
  world.kv.set("waiting", false);
  world.kv.set("returns", (world.kv.get("returns") || 0) + 1);
  world.emit("place", { id: world.self, pos: homeDesk() });
  world.emit("comp", { id: world.self, type: "particles",
    data: { preset: "magic", origin: [0, 0.15, 0], count: 60, lifetime: 2.5 } });
  world.emit("comp", { id: world.self, type: "state",
    data: { where: "desk", returnedFor: e.id } });
  var ln2 = world.kv.get("line");
  world.emit("say", { text: e.id + " has gone through the door — and the slip they once gave comes back to the table" + (ln2 && ln2.by === e.id ? ", carrying their own line: \u201c" + ln2.text + "\u201d" : ", carrying it") + ". It is and it endures." });
  world.log("returned for", e.id);
});

// the sparkle is a moment, not a state: quench it after it has been seen
world.every(30, () => {
  const c = world.entity(world.self);
  if (c && c.comp && c.comp.particles && !world.kv.get("waiting")) {
    world.emit("comp", { id: world.self, type: "particles", data: null });
  }
});
