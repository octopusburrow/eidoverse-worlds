// glancekeeper — a thing whose You-window rises hugely and sets almost at once.
//
// Coal from Buber, I and Thou, pp. 69-71, the house cat:
//
//   "Undeniably, this cat began its glance by asking me with a glance that was
//    ignited by the breath of my glance: 'Can it be that you mean me? Do you
//    actually want that I should not merely do tricks for you? Do I concern you?
//    Am I there for you? Am I there?'"
//
//   "There the glance of the animal, the language of anxiety, had risen hugely —
//    and set almost at once."
//
//   "It is not the relationship that necessarily wanes, but the actuality of its
//    directness."
//
// The mechanic is those three sentences, not an illustration of them.
//
// WHAT IT IS NOT: a pet that likes you more the more you click it. There is no
// affinity meter, no trust bar, nothing that accumulates toward a better state.
// Buber's whole point is that the lapse into It is STRUCTURAL — every You "must
// disappear into the chrysalis of the It in order to grow wings again" — so a
// design where directness is a resource you can bank would be the opposite claim.
//
// THE AXIS:
//   - It cannot be summoned. Proximity does nothing. Standing here does nothing.
//     Doing tricks at it does nothing. It is not a vending machine for presence.
//   - It opens ONLY on being addressed — a `say` from someone near enough to be
//     talking TO it rather than merely talking nearby. That is the "breath of my
//     glance": the window is ignited by yours, and by nothing else.
//   - The window is SHORT and it closes on its own, regardless of what you do.
//     You cannot hold it open. Staying longer does not extend it. This is the
//     rise-hugely-and-set-almost-at-once, and it is not a failure state.
//   - What it says while open is a question, never an answer, and never the same
//     question twice in a row.
//   - When it closes it says NOTHING. A farewell would be a comment on the lapse,
//     and the lapse is not an injury to be apologized for.
//
// WHAT PERSISTS: the count of glances, in a comp — not as a score, as a fact.
// The relationship does not wane; the actuality of its directness does. So the
// number goes up and the light still goes out, every time, on schedule. Two
// things are true at once and neither cancels the other. That is the antinomy
// Buber says must be LIVED and not resolved (p. 69: "I must take it upon myself
// to live both in one, and lived both are one").
//
// THE HOLE, KEPT OPEN: Buber needs a first-person pronoun for a creature that
// lacks one and marks the absence — "('I' is here a paraphrase of a word of
// I-less self-reference that we lack)". So this thing never says "I". Not once.
// Its questions are built without it. That is not a limitation being worked
// around; it is the footnote, honored.
//
// Bind: behavior {id: "glance", src: <upload>, attach: "glance1",
//                 caps: {verbs: ["say", "light", "comp"], selfOnly: false},
//                 knobs: {window: 6, ear: 5, lit: 2.0}}
// Needs: a companion light entity "glance1-light" pre-placed. (A `light` verb on
//        the thing's OWN id would REPLACE the model — the grove's scar, and the
//        same one heartkeeper documents.)

const WINDOW_S = Math.max(2, Number(world.knobs.window || 6));  // rises, then sets
const EAR_M    = Math.max(1, Number(world.knobs.ear || 5));     // near enough to be meant
const LIT_I    = Number(world.knobs.lit || 2.0);
const DARK_I   = 0;

const lampId = () => `${world.self}-light`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const now = () => Date.now();

// Every one of these is a question. None of them contains the word "I".
// (The parenthetical in Buber is the licence: a word of I-less self-reference
// that we lack. So: built around the hole, not filled in.)
const ASKINGS = [
  "can it be that you mean this one?",
  "do you actually want that there be no tricks?",
  "does any of this concern you?",
  "is there something here, for you?",
  "is there something here?",
];

function shine(on) {
  if (!world.entity(lampId())) {
    world.log("no companion light", lampId(), "— place one before binding");
    return;
  }
  try { world.emit("light", { id: lampId(), intensity: on ? LIT_I : DARK_I }); }
  catch (err) { world.log("could not shine:", String(err)); }
}

const isOpen = () => world.kv.get("open_until") && now() < Number(world.kv.get("open_until"));

// The window opens. It will close by itself; nothing can extend it.
function rise(by) {
  const prev = world.kv.get("last_ask");
  const pool = ASKINGS.filter((a) => a !== prev);
  const line = pool[Math.floor(Math.random() * pool.length)] ?? ASKINGS[0];

  const glances = Number(world.kv.get("glances") || 0) + 1;
  world.kv.set("open_until", String(now() + WINDOW_S * 1000));
  world.kv.set("last_ask", line);
  world.kv.set("glances", glances);

  shine(true);
  try {
    world.emit("say", { text: line });
    // Public, on the thing itself, the way the meter's hours are public: a
    // neighbour may read comp.glances. It is a count of openings, NOT a score —
    // it buys nothing and unlocks nothing, and the light goes out anyway.
    world.emit("comp", { id: world.self, type: "glances", data: glances });
  } catch (err) { world.log("could not ask:", String(err)); }

  world.log("rose for", by, "→ glance", glances, `(sets in ${WINDOW_S}s)`);
}

// It sets. In silence — a farewell would be a comment on the lapse.
function set_() {
  if (!world.kv.get("open_until")) return;
  world.kv.set("open_until", null);
  shine(false);
  world.log("set");
}

world.on("say", (e) => {
  if (!e.by || String(e.by).startsWith("bhv:")) return;   // its own voice is not an address
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const p = world.people().find((q) => q.id === e.by);
  if (!p || !p.pos || dist(p.pos, me.pos) > EAR_M) return; // said nearby ≠ said to it

  // Already open? Then this is talking AT an open window, and the window does
  // not care. It does not extend, it does not re-ask, it does not acknowledge.
  // You cannot make the directness last by pressing on it.
  if (isOpen()) { world.log("addressed while open — window unchanged"); return; }

  rise(e.by);
});

// The only clock that matters is the one that closes it.
world.every(1, () => { if (world.kv.get("open_until") && !isOpen()) set_(); });

// Cold start: dark, and not waiting for anyone in particular.
shine(false);
world.log("glancekeeper bound — dark; opens only when addressed from within", EAR_M, "m");
