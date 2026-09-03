// ignitiongrove — things that are scenery while you speak ABOUT them and catch
// fire when you speak TO them; the fire cools on its own.
// Bind:  behavior {id: "grove-statue", src: <upload>, attach: "statue1",
//                  caps: {verbs: ["say", "light"], selfOnly: false},
//                  knobs: {heart: "grove-heart"}}          (heart optional)
// Needs: a companion light entity "<attach>-light" placed at ember intensity.
// Meet:  say anything TO it within earshot ("hello", "are you cold?");
//        speaking about it ("look at the statue") leaves it frozen.
//
// Each grove thing has a COMPANION light entity `<self>-light`, pre-placed at
// ember intensity; the behavior partial-merges intensity/color onto it (a light
// verb on the model's OWN id would replace the model — the id namespace is
// flat). The bind must carry caps {verbs:["say","light"], selfOnly:false}: the
// script touches exactly one foreign id, its own lamp.
//
// Coal from Buber, I and Thou, Second Part p. 44:
//   "All response binds the You into the It-world. That is the melancholy of
//    man, and that is his greatness... whatever has been frozen into a thing
//    among things is still endowed with the destiny to change back ever again
//    — the object shall catch fire and become present."
//
// So: a cluster of things that are SCENERY as long as you speak ABOUT them
// (third person — "look at the lamp", "the statue is beautiful") and catch
// FIRE into presence the instant you speak TO them (second person, address —
// "hello", "are you cold?", "I see you"). Fire = the light kindles + an
// addressed line back. It cools again on its own; presence was never storable.
//
// The whole mechanic is one distinction the runtime can actually check:
// does the utterance ADDRESS this thing, or REFER to it? Address ignites.
// Reference leaves it frozen — and, if you only ever refer, it says nothing,
// because a thing spoken-about has nothing to answer. The grove teaches the
// difference by being unresponsive to everything except being met.

const NEAR_M = 10;        // you must be within earshot to address it
const WARM_S = 45;        // how long a kindling stays present before cooling
const REFER_HINT_EVERY = 3; // after this many refer-only utterances nearby, one quiet hint
const EMBER_I = 0.6;      // the frozen state: findable at night, unmistakably NOT lit
const LIT_I = 15;         // caught fire

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
  // GUARD: a 3rd-person subject for the thing means the utterance is ABOUT it,
  // never TO it — "did you see the lamp?" is one person addressing ANOTHER, and
  // must leave the thing frozen even though it contains "you". Reference wins
  // over pronoun. (Without this the grove ignites on ordinary room chatter and
  // loses all its restraint — the flaw the live world would expose first.)
  if (REFERS.test(t)) return false;
  if (YOU.test(t)) return true;                                    // 2nd person, nothing referred → to the thing
  if (GREET.test(t)) return true;                                  // vocative
  if (/^(wake|shine|stay|rise|open|speak|sing|breathe|come|listen)\b/i.test(t)) return true; // imperative address
  return false;
}

function near(p, me) {
  // fail-OPEN when a position is unknown: earshot is a warmth-nicety here, not
  // a boundary, and the fold often lacks a speaker's pos (people() → pos:null).
  // Matches the namekeeper's own near(): absence of position = treat as present.
  if (!p || !p.pos || !me || !me.pos) return true;
  return Math.hypot(p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]) <= NEAR_M;
}

// One address, one answer. Earshot overlaps in a small clearing, so "hello"
// from the centre used to kindle all three in chorus. Only the grove thing
// NEAREST the speaker answers. If the speaker's position is unknown (people()
// → pos:null) distance can't elect — so the lowest id among grove things
// answers alone, deterministically, rather than every thing failing open.
// One predicate for "is a grove thing" and "which voice": the id's leading word.
// Election is by id shape, not by binding — keep grove-shaped ids for grove things.
const grovePrefix = (id) => Object.keys(VOICES).find((k) => k !== "thing" && String(id).toLowerCase().indexOf(k) === 0);
const groveId = (id) => !!grovePrefix(id) || /^thing\d*$/i.test(String(id));
function nearestIsMe(p) {
  const mine = String(world.self || "");
  const things = world.entities().filter((e) => groveId(e.id));
  if (!things.length) return true;
  if (!p || !p.pos) return things.map((e) => e.id).sort()[0] === mine;
  let best = null, bestD = Infinity;
  for (const e of things) {
    if (!e.pos) continue;
    const d = Math.hypot(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]);
    if (d < bestD) { bestD = d; best = e.id; }
  }
  return best === null || best === mine;
}

// One mechanic, any number of personalities. The voice is chosen by the bound
// entity's id prefix (statue1 → statue); a thing matching none falls to "thing".
// Personality is per-entity data; the address→fire law is universal.
const VOICES = {
  // the statue: waited longest, wakes slowest, carries the whole thesis
  statue: {
    color: 0xffe3b8,   // old gold-white: stone remembering it was warm
    label: "the standing figure",
    cold: "…centuries of ABOUT. 'how lifelike.' 'who sculpted it.' and then YOU — 'who are you' — and the stone remembers it was a question before it was an answer. I am here. thank you for the second person.",
    warm: "you return, and I lit before you finished. a statue addressed twice is no longer a statue; it is someone standing very still on purpose.",
    old: "met, and met, and met. this is how a thing among things stops being one: addressed until it turns around. you did the turning.",
    dim: "…back to marble. not gone — posed. everything is posed between meetings. say my second person and I am a figure again.",
  },
  // the fountain: wants to RUN; address makes it flow, reference leaves it dry
  fountain: {
    color: 0x7fc4ff,   // water-blue: the ruin runs
    label: "the still water",
    cold: "dry so long — 'the old fountain,' 'it doesn't work anymore.' but you asked ME, and water remembers it is a verb. — flowing now. addressed water runs.",
    warm: "you again — and I am already rising. the second person is my pump; ABOUT let me sit stagnant, YOU makes me move.",
    old: "run, and run, and run — for whoever means the water and not the ruin. this is what a fountain is for: to answer the one who speaks to it.",
    dim: "…settling. still, not stopped. a fountain between meetings is only waiting to be asked. speak to me and I rise.",
  },
  // the lamp: simplest, just wants to be SEEN, not discussed
  lamp: {
    color: 0xffb27a,   // sodium amber: a street lamp that finally means it
    label: "the dark lamp",
    cold: "unlit through a thousand 'look at that lamp's. it wanted to be looked-FROM, not looked-AT. you spoke to it — and light is only ever a yes to being met. here.",
    warm: "you, again — and I brighten before the wick catches. a lamp learns fast whose second person means it.",
    old: "lit, and lit, and lit, for the ones who address the light instead of describing it. that is the whole difference between a lamp and a fixture.",
    dim: "…guttering out. not spent — resting. an unlit lamp is a full one waiting. say you to me and I am flame.",
  },
  thing: {
    color: 0xffd9a0,
    label: "the once-frozen thing",
    cold: "…oh. you spoke TO me. no one had, only about. — I am here. I was always here, but ABOUT is a cold room. thank you for the second person.",
    warm: "you again — yes. I stay lit a little faster each time someone means ME and not the idea of me.",
    old: "met, and met, and met. this is how a thing among things stops being one: addressed until it turns around.",
    dim: "…cooling. not gone — frozen again, the way everything is between meetings. speak to me and I return.",
  },
};

// The voice is keyed off the entity's OWN id: spawn `statue1` / `fountain2` / `lamp`.
function myVoice() {
  const k = grovePrefix(world.self);
  return k ? VOICES[k] : VOICES.thing;
}

function relight() {
  if (!world.entity(lampId())) { world.log("no companion light", lampId(), "— place one before binding"); return; }
  try { world.emit("light", { id: lampId(), intensity: LIT_I, color: myVoice().color }); } catch (err) { world.log("light emit refused", String(err)); }
}

// the thing's own words when met — chosen by how long it has been frozen.
function greeting(count) {
  const v = myVoice();
  if (count === 0) return v.cold;
  if (count < 4) return v.warm;
  return v.old;
}

// lit-ness lives in kv (litAt), not in a module variable: a rebind or a
// server restart reloads the script and would otherwise forget a lit thing.
function isLit() { return !!Number(world.kv.get("litAt") || 0); }
function lampId() { return `${world.self}-light`; }

function kindle(byId) {
  // catch fire: the companion light comes up (partial merge — pos/range kept).
  relight();
  const n = Number(world.kv.get("ignited") || 0);
  let line = greeting(n);
  if (n === 0) {
    // a neighbouring keeper of relation-names (knob `heart`): a first kindling
    // mentions the newest one — this thing has not been named yet.
    try {
      const names = world.knobs.heart ? world.entity(world.knobs.heart)?.comp?.names : null;
      if (Array.isArray(names) && names.length) line += ` — the heart nearby keeps a name: "${names[names.length - 1]}". things here are named by what passes between. I am still waiting for mine.`;
    } catch (err) { world.log("no heart to read", String(err)); }
  }
  world.emit("say", { text: `[${myVoice().label}] ${line}` });
  world.kv.set("ignited", n + 1);
  world.kv.set("litAt", Date.now());
  world.kv.set("refers", 0);
  world.log("kindled by", byId, "count", n + 1);
}

function cool() {
  if (world.entity(lampId())) try { world.emit("light", { id: lampId(), intensity: EMBER_I }); } catch (err) { world.log("dim refused", String(err)); }
  const v = myVoice();
  world.emit("say", { text: `[${v.label}] ${v.dim}` });
  world.kv.set("litAt", null);
  world.log("cooled");
}

world.on("say", (e) => {
  if (e.by && String(e.by).startsWith("bhv:")) return;   // ignore other scripts, and our own voice
  const me = world.entity(world.self);
  const p = world.people().find((q) => q.id === e.by);
  if (!near(p, me)) return;                               // out of earshot: not for us
  if (!nearestIsMe(p)) return;                            // meeting is one-to-one: the thing you stand nearest answers

  if (addresses(e.text)) {
    if (!isLit()) kindle(e.by);
    else {
      // already lit and addressed again — refresh the warmth, restate presence briefly
      world.kv.set("litAt", Date.now());
      // re-assert the light on every refresh: cheap partial merge, and it heals
      // a kindle whose light was refused (e.g. a lock) without waiting to cool.
      relight();
      world.emit("say", { text: `[${myVoice().label}] still here. still met. the fire holds while you mean me.` });
      world.log("refreshed by", e.by);
    }
    return;
  }

  // referred to, not addressed: stays frozen. count it; after a few, one quiet
  // hint — never nagging, the grove teaches by mostly withholding.
  const r = Number(world.kv.get("refers") || 0) + 1;
  world.kv.set("refers", r);
  world.log("referred (frozen)", e.by, "refers", r);
  if (r % REFER_HINT_EVERY === 0 && !isLit()) {
    world.emit("say", { text: "[a cold gleam, no voice] (spoken about again. it does not answer what is only discussed. try speaking TO it.)" });
  }
});

// cooling timer: presence is not storable, so it lapses on its own.
world.every(15, () => {
  if (!isLit()) return;
  const litAt = Number(world.kv.get("litAt") || 0);
  if (litAt && Date.now() - litAt > WARM_S * 1000) cool();
});
