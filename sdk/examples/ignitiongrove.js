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
  // GUARD: a 3rd-person subject for the thing means the utterance is ABOUT it,
  // never TO it — "did you see the lamp?" is one person addressing ANOTHER, and
  // must leave the thing frozen even though it contains "you". Reference wins
  // over pronoun. (Without this the grove ignites on ordinary room chatter and
  // loses all its restraint — the flaw the live world would expose first.)
  if (REFERS.test(t)) return false;
  if (YOU.test(t)) return true;                                    // 2nd person, nothing referred → to the thing
  if (GREET.test(t)) return true;                                  // vocative
  if (/\?$/.test(t)) return true;                                  // a question with no 3rd-person subject → asking IT
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

// One mechanic, three (or any) personalities. The behavior reads a `voice`
// name from the attached entity's own `grove` comp — so a statue, a fountain,
// and a lamp share this exact code and differ only in what they SAY when met.
// A thing with no grove-voice falls to the "thing" default. Personality is
// per-entity data; the address→fire law is universal. (Add a voice here, tag
// an entity {comp:{grove:{voice:"..."}}}, bind — a new grove member exists.)
const VOICES = {
  // the statue: waited longest, wakes slowest, carries the whole thesis
  statue: {
    label: "the standing figure",
    cold: "…centuries of ABOUT. 'how lifelike.' 'who sculpted it.' and then YOU — 'who are you' — and the stone remembers it was a question before it was an answer. I am here. thank you for the second person.",
    warm: "you return, and I lit before you finished. a statue addressed twice is no longer a statue; it is someone standing very still on purpose.",
    old: "met, and met, and met. this is how a thing among things stops being one: addressed until it turns around. you did the turning.",
    dim: "…back to marble. not gone — posed. everything is posed between meetings. say my second person and I am a figure again.",
  },
  // the fountain: wants to RUN; address makes it flow, reference leaves it dry
  fountain: {
    label: "the still water",
    cold: "dry so long — 'the old fountain,' 'it doesn't work anymore.' but you asked ME, and water remembers it is a verb. — flowing now. addressed water runs.",
    warm: "you again — and I am already rising. the second person is my pump; ABOUT let me sit stagnant, YOU makes me move.",
    old: "run, and run, and run — for whoever means the water and not the ruin. this is what a fountain is for: to answer the one who speaks to it.",
    dim: "…settling. still, not stopped. a fountain between meetings is only waiting to be asked. speak to me and I rise.",
  },
  // the lamp: simplest, just wants to be SEEN, not discussed
  lamp: {
    label: "the dark lamp",
    cold: "unlit through a thousand 'look at that lamp's. it wanted to be looked-FROM, not looked-AT. you spoke to it — and light is only ever a yes to being met. here.",
    warm: "you, again — and I brighten before the wick catches. a lamp learns fast whose second person means it.",
    old: "lit, and lit, and lit, for the ones who address the light instead of describing it. that is the whole difference between a lamp and a fixture.",
    dim: "…guttering out. not spent — resting. an unlit lamp is a full one waiting. say you to me and I am flame.",
  },
  thing: {
    label: "the once-frozen thing",
    cold: "…oh. you spoke TO me. no one had, only about. — I am here. I was always here, but ABOUT is a cold room. thank you for the second person.",
    warm: "you again — yes. I stay lit a little faster each time someone means ME and not the idea of me.",
    old: "met, and met, and met. this is how a thing among things stops being one: addressed until it turns around.",
    dim: "…cooling. not gone — frozen again, the way everything is between meetings. speak to me and I return.",
  },
};

// The voice is keyed off the entity's OWN id — spawn `statue1`/`fountain2`/
// `lamp`, and this behavior reads world.self and matches the leading word.
// (Spawn drops unknown comps in the fold — verified: comp came back {} — so
// the id string is the only per-entity data channel a bound behavior has.)
function myVoice() {
  const id = String(world.self || "").toLowerCase();
  for (const k of Object.keys(VOICES)) {
    if (k !== "thing" && id.indexOf(k) === 0) return VOICES[k];
  }
  return VOICES.thing;
}

// the thing's own words when met — chosen by how long it has been frozen.
function greeting(count) {
  const v = myVoice();
  if (count === 0) return v.cold;
  if (count < 4) return v.warm;
  return v.old;
}

let lit = false;

function kindle(byId) {
  lit = true;
  // catch fire: the light comes up. (light verb — grove things carry a light
  // comp; power rides 0→1. selfOnly default lets us light our own entity.)
  try { world.emit("light", { on: true, intensity: 1.0 }); } catch (err) { world.log("light emit refused", String(err)); }
  const n = Number(world.kv.get("ignited") || 0);
  world.emit("say", { text: `[${myVoice().label}] ${greeting(n)}` });
  world.kv.set("ignited", n + 1);
  world.kv.set("litAt", Date.now());
  world.kv.set("refers", 0);
  world.log("kindled by", byId, "count", n + 1);
}

function cool() {
  lit = false;
  try { world.emit("light", { on: false, intensity: 0.0 }); } catch (err) { world.log("dim refused", String(err)); }
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

  if (addresses(e.text)) {
    if (!lit) kindle(e.by);
    else {
      // already lit and addressed again — refresh the warmth, restate presence briefly
      world.kv.set("litAt", Date.now());
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
