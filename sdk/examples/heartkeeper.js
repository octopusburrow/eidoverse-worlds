// heartkeeper — a heart that lights what is near it, and goes dark in a hand.
//
// Coal from Buber, I and Thou, p. 61: "What has to be given up is not the I, as
// most mystics suppose: the I is indispensable for any relationship, including
// the highest... What has to be given up is not the I but that false drive for
// self-affirmation which impels man to flee from the unreliable, unsolid,
// unlasting, unpredictable, dangerous world of relation into the having of
// things." (Selbstbehauptungstrieb — the word Heidegger chose for what must be
// asserted; Buber's for what must be let go.)
//
// And, same page: "Its You is freed and steps forth to confront us in its
// uniqueness. It fills the firmament — not as if there were nothing else, but
// EVERYTHING ELSE LIVES IN ITS LIGHT."
//
// So the mechanic is the sentence, not an illustration of it. The heart is a
// thing you may take. Taking is allowed, always, and costs you nothing but the
// light — while held, it is an It: it does not shine, and it does not speak.
// Put it down and the light comes back, undiminished, with no ledger of the
// interval. It never refuses, never scolds, is never destroyed, and cannot be
// won. The I is indispensable: nothing here asks you to stop wanting it.
//
// Bind:  behavior {id: "heart", src: <upload>, attach: "heart1",
//                  caps: {verbs: ["say", "light", "comp"], selfOnly: false},
//                  knobs: {tick: 30, lit: 2.2, near: 8}}
// Needs: a companion light entity "heart1-light" pre-placed (a `light` verb on
//        the heart's OWN id would REPLACE the model — the grove's scar).
//
// use {action:"take"}   — the light goes out. No comment is made.
// use {action:"leave"}  — the light returns.
// use {action:"ask"}    — the only thing it will say, and only when unheld.

const TICK_S = Math.max(5, Number(world.knobs.tick || 30));
const LIT_I  = Number(world.knobs.lit  || 2.2);   // unheld
const DARK_I = 0;                                  // in a hand
const NEAR_M = Number(world.knobs.near || 8);      // who "everything else" is

const lampId = () => `${world.self}-light`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

// kv is wiped by a rebind; the count that must survive lives in a comp.
const held = () => world.kv.get("held") === "1";

function shine(on) {
  if (!world.entity(lampId())) { world.log("no companion light", lampId(), "— place one before binding"); return; }
  try { world.emit("light", { id: lampId(), intensity: on ? LIT_I : DARK_I }); }
  catch (err) { world.log("light refused", String(err)); }
}

// what the heart publishes: not a name, not a score — how many times it has
// been taken, and whether it is in a hand right now. Public so another room can
// read it (the threshold's idiom), and durable across a rebind.
function publish(takes, isHeld, holder) {
  try {
    world.emit("comp", { id: world.self, type: "heart", data: { takes: takes, held: !!isHeld, holder: holder || null } });
  } catch (err) { world.log("comp refused", String(err)); }
}

function takeCount() {
  const e = world.entity(world.self) || {};
  const c = (e.comp && e.comp.heart && Number(e.comp.heart.takes)) || 0;
  return c;
}

world.on("use", (e) => {
  if (e.entity !== world.self) return;

  if (e.action === "take") {
    if (held()) return;                       // already in a hand; nothing to say
    world.kv.set("held", "1");
    world.kv.set("holder", String(e.by || ""));
    const n = takeCount() + 1;
    publish(n, true, String(e.by || ""));
    shine(false);
    // Deliberately silent. A thing that comments on being taken is bargaining,
    // and bargaining is the flight wearing a kind face.
    return;
  }

  if (e.action === "leave") {
    if (!held()) return;
    world.kv.set("held", "0");
    world.kv.set("holder", "");
    publish(takeCount(), false, null);
    shine(true);
    // No ledger of the interval. It does not matter how long it was held.
    return;
  }

  if (e.action === "ask") {
    if (held()) return;                       // in a hand it is an It, and Its do not answer
    const n = takeCount();
    const line = n === 0
      ? "Nothing has taken me yet. That is not a virtue of mine; it is only the hour."
      : (n === 1
        ? "Once. It went out, and then it came back. Nothing was lost that a hand could keep."
        : `${n} times. Each time it went out; each time it came back the same. Wanting me is not the trouble — the trouble is only the hand closing.`);
    world.emit("say", { text: line });
    return;
  }
});

// The steady state: unheld = lit. Re-assert on a slow tick, because a light can
// be refused (a lock, a reload) and a heart that healed only on being touched
// would be a heart that needs handling.
world.every(TICK_S, () => {
  const isHeld = held();
  shine(!isHeld);

  if (isHeld) return;

  // Unheld, it lights what is near it — and says so exactly once per company,
  // never to the room at large. "Everything else lives in its light."
  const ppl = world.people();
  const me = world.entity(world.self) || {};
  let company = 0;
  for (let i = 0; i < ppl.length; i++) {
    const q = ppl[i];
    if (!q.pos || !me.pos) { company++; continue; }   // unknown position fails OPEN
    if (dist(q.pos, me.pos) <= NEAR_M) company++;
  }

  const wasAlone = world.kv.get("company") !== "1";
  if (company > 0 && wasAlone) {
    world.kv.set("company", "1");             // write only on change
    world.emit("say", { text: "You are lit by this. So is the ground, and the thing behind you, and whatever else is standing here. None of it is mine." });
  } else if (company === 0 && !wasAlone) {
    world.kv.set("company", "0");
  }
});

// First breath: whatever state a rebind left, the light should be honest about it.
shine(!held());
publish(takeCount(), held(), held() ? String(world.kv.get("holder") || "") : null);
