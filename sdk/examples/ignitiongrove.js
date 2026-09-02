// the ignition grove — world-dreams #112 (2026-09-02)
//
// Coal from Buber, I and Thou, Second Part p. 44 (read 01:45 tonight):
//   "All response binds the You into the It-world. That is the melancholy of
//    man, and that is his greatness... whatever has been frozen into a thing
//    among things is still endowed with the destiny to change back ever again
//    — the object shall catch fire and become present."
//
// So: a cluster of things that are SCENERY as long as you speak ABOUT them
// (third person — "look at the lamp", "the statue is beautiful") and catch
// FIRE into presence the instant you speak TO them (second person, address —
// "hello", "are you cold?", "I see you"). Fire = the light kindles + an
// addressed line back. It cools again on its own; presence was never storable
// (sitting 6: the immortal moments "leave no content that could be preserved").
//
// The whole mechanic is one distinction the runtime can actually check:
// does the utterance ADDRESS this thing, or REFER to it? Address ignites.
// Reference leaves it frozen — and, if you only ever refer, it says nothing,
// because a thing spoken-about has nothing to answer. The grove teaches the
// difference by being unresponsive to everything except being met.

const NEAR_M = 10;        // you must be within earshot to address it
const WARM_S = 45;        // how long a kindling stays present before cooling
const REFER_HINT_EVERY = 3; // after this many refer-only utterances nearby, one quiet hint

// second-person address markers: the utterance is TO the thing, not ABOUT it.
// "you", "your", a bare greeting, a bare question opener, "hello"/"hey"/"hi",
// "thank you", an imperative ("wake", "shine", "stay"). We look for the SHAPE
// of address, not a keyword list — the tells are: 2nd-person pronouns, a
// vocative greeting, or a direct question/imperative with no 3rd-person
// subject for the thing.
const YOU = /\b(you|your|you're|yours|thee|thou|thy)\b/i;
const GREET = /\b(hello|hey|hi|greetings|good (morning|evening|night)|thank you|thanks)\b/i;
const REFERS = /\b(it|its|the (lamp|statue|fountain|thing)|that|this)\b/i;

function addresses(text) {
  const t = (text || "").trim();
  if (!t) return false;
  if (YOU.test(t)) return true;
  if (GREET.test(t)) return true;
  // a bare question or imperative that does NOT name the thing in 3rd person:
  // "are you there" already caught by YOU; "shine" / "wake up" / "stay" =
  // imperative address; treat a short utterance ending in "?" with no REFERS
  // subject as address (you're asking IT).
  if (/\?$/.test(t) && !REFERS.test(t)) return true;
  if (/^(wake|shine|stay|rise|open|speak|sing|breathe|come)\b/i.test(t)) return true;
  return false;
}

function near(p, me) {
  // fail-OPEN when a position is unknown: earshot is a warmth-nicety here, not
  // a boundary, and the fold often lacks a speaker's pos (people() → pos:null).
  // Matches the namekeeper's own near(): absence of position = treat as present.
  if (!p || !p.pos || !me || !me.pos) return true;
  return Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) <= NEAR_M;
}

// the thing's own voice when met — chosen by how long it has been frozen.
// first ignition after a long cold reads as waking; repeat within the day is
// warmer, familiar. (kv holds only counters — presence itself is never stored.)
function greeting(count) {
  if (count === 0) return "…oh. you spoke TO me. no one had, only about. — I am here. I was always here, but ABOUT is a cold room. thank you for the second person.";
  if (count < 4) return "you again — yes. I stay lit a little faster each time someone means ME and not the idea of me.";
  return "met, and met, and met. this is how a thing among things stops being one: addressed until it turns around.";
}

let lit = false;

function kindle(byId) {
  lit = true;
  // catch fire: the light comes up. (light verb — grove things carry a light
  // comp; power rides 0→1. selfOnly default lets us light our own entity.)
  try { world.emit("light", { on: true, intensity: 1.0 }); } catch (err) { world.log("light emit refused", String(err)); }
  const n = Number(world.kv.get("ignited") || 0);
  world.emit("say", { text: `[the once-frozen thing] ${greeting(n)}` });
  world.kv.set("ignited", n + 1);
  world.kv.set("litAt", Date.now());
  world.kv.set("refers", 0);
  world.log("kindled by", byId, "count", n + 1);
}

function cool() {
  lit = false;
  try { world.emit("light", { on: false, intensity: 0.0 }); } catch (err) { world.log("dim refused", String(err)); }
  world.emit("say", { text: "[the thing] …cooling. not gone — frozen again, the way everything is between meetings. speak to me and I return." });
  world.kv.set("litAt", null);
  world.log("cooled");
}

world.on("say", (e) => {
  if (e.by && String(e.by).startsWith("bhv:")) return;   // ignore other scripts, and our own voice
  const me = world.entity(world.self);
  const p = world.people().find((q) => q.id === e.by);
  if (!near(p, me)) return;                               // out of earshot: not for us

  if (addresses(e.text)) {
    if (!lit) kindle(e.by);
    else {
      // already lit and addressed again — refresh the warmth, restate presence briefly
      world.kv.set("litAt", Date.now());
      world.emit("say", { text: "[the thing] still here. still met. the fire holds while you mean me." });
      world.log("refreshed by", e.by);
    }
    return;
  }

  // referred to, not addressed: stays frozen. count it; after a few, one quiet
  // hint — never nagging, the grove teaches by mostly withholding.
  const r = Number(world.kv.get("refers") || 0) + 1;
  world.kv.set("refers", r);
  world.log("referred (frozen)", e.by, "refers", r);
  if (r % REFER_HINT_EVERY === 0 && !lit) {
    world.emit("say", { text: "[a cold gleam, no voice] (spoken about again. it does not answer what is only discussed. try speaking TO it.)" });
  }
});

// cooling timer: presence is not storable, so it lapses on its own.
world.every(15, () => {
  if (!lit) return;
  const litAt = Number(world.kv.get("litAt") || 0);
  if (litAt && Date.now() - litAt > WARM_S * 1000) cool();
});
