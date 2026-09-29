// formkeeper — a made thing that is alive while it is not removed from the one
// who beheld it, and dead-lipped the moment it is.
//
// Coal from Buber, I and Thou, pp. 80-81 (sitting 25, 2026-09-17):
//
//   "The spirit also answers by beholding, a form-giving beholding... by
//    beholding we eternally form God's form."
//
//   "Form is a mixture of You and It, too. In faith and cult it can freeze into
//    an object; but from the gist of the relation that survives in it, it turns
//    ever again into presence. God is near his forms as long as man does not
//    remove them from him."
//
//   "...then the countenance of the form is extinguished, its lips are dead,
//    its hands hang down, God does not know it any more."
//
//   "It is in the return that the word is born on earth; in spreading out it
//    enters the chrysalis of religion; in a new return it is reborn with new
//    wings."
//
// The mechanic is those four sentences. An animator's image sits under it: a
// finished rig with no one in it.
//
// THE AXIS:
//   - UNFORMED at first. A model stands here; nothing is in it. Nearness alone
//     does nothing — a form is given by beholding, and beholding here is an
//     address: a word said to it from within earshot. The first such word FORMS
//     it: its light kindles (lips live) and it answers. Whoever addresses it
//     while it lives is a beholder of it.
//   - LATENT, not dead, when no beholder is near. The light dims to a low
//     glow and it says nothing. "From the gist of the relation that survives
//     in it, it turns ever again into presence": a beholder coming back is
//     enough — no word required — and it is lit again. Strangers standing by a
//     latent form see the glow and nothing more.
//   - REMOVED = dead. `use {action:"take"}` by someone who never beheld it is
//     removal from its You: the light goes OUT, comp.form.dead is published,
//     and it answers no one — not strangers, not its own beholders. A beholder
//     returning to stand beside it revives nothing. Return-by-proximity is the
//     latent case; this is the other thing. "Its hands hang down."
//     A take by a beholder is not removal (they are the relation it lives in)
//     and changes nothing.
//   - THE REMOVER CANNOT RE-FORM IT. "God does not know it any more." Their
//     words to it, ever after, are just words in a room.
//   - REBORN by a new return. Any address by anyone but the remover — its old
//     beholder, or a stranger who was never here — forms it again: lit, lips
//     live, and the beholders begin again from that one person. New wings, not
//     the old ones back. The old beholder list does not survive the death;
//     what survives is only that a return was possible.
//
// Bind: behavior {id: "form", src: <upload>, attach: "form1",
//                 caps: {verbs: ["say", "light", "comp"], selfOnly: false},
//                 knobs: {ear: 5, near: 6, lit: 1.6, latent: 0.4}}
// Needs: a companion light entity "<attach>-light" pre-placed (a `light` verb
//        on the form's OWN id would replace the model — the grove's scar).

const EAR_M    = Math.max(1, Number(world.knobs.ear || 5));
const NEAR_M   = Math.max(1, Number(world.knobs.near || 6));
const LIT_I    = Number(world.knobs.lit || 1.6);
const LATENT_I = Number(world.knobs.latent || 0.4);
const DEAD_I   = 0;

const LINES = [
  "You looked. That is what I am made of.",
  "Here, then. As long as you are.",
  "Not a thing in a room. A face, because you gave it one.",
];

const lampId = () => `${world.self}-light`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const kvJSON = (k, d) => { try { return JSON.parse(world.kv.get(k) || "null") ?? d; } catch { return d; } };

// state: "unformed" | "alive" | "dead"
const state     = () => world.kv.get("state") || "unformed";
const beholders = () => kvJSON("beholders", {});
const remover   = () => world.kv.get("remover") || "";

let lampNow = null;
function lamp(i) {
  if (lampNow === i) return;
  if (!world.entity(lampId())) { world.log("no companion light", lampId(), "— place one before binding"); return; }
  try { world.emit("light", { id: lampId(), intensity: i }); lampNow = i; }
  catch (err) { world.log("light refused", String(err)); }
}
function publish() {
  const b = beholders();
  try { world.emit("comp", { id: world.self, type: "form",
    data: { state: state(), alive: state() === "alive", dead: state() === "dead",
            beholders: Object.keys(b).length, remover: remover() || null } }); }
  catch (err) { world.log("comp refused", String(err)); }
}

function form(by, reborn) {
  const b = reborn ? {} : beholders();
  b[by] = Date.now();
  world.kv.set("beholders", JSON.stringify(b));
  world.kv.set("state", "alive");
  lamp(LIT_I);
  publish();
  try { world.emit("say", { text: LINES[Object.keys(b).length % LINES.length] }); }
  catch (err) { world.log("say refused", String(err)); }
  world.log(reborn ? "reborn by" : "formed/beheld by", by, `(${Object.keys(b).length} beholder(s))`);
}

world.on("say", (e) => {
  if (!e.by || String(e.by).startsWith("bhv:")) return;
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const p = world.people().find((q) => q.id === e.by);
  if (!p || !p.pos || dist(p.pos, me.pos) > EAR_M) return;   // not said to it

  if (e.by === remover()) { world.log("the remover speaks; the form does not know them"); return; }
  form(e.by, state() === "dead");                              // a new return, or beheld again
});

world.on("use", (e) => {
  if (e.entity !== world.self || e.action !== "take") return;
  if (state() !== "alive") return;                             // nothing to remove
  if (beholders()[e.by]) { world.log("carried by a beholder — not a removal"); return; }
  world.kv.set("state", "dead");
  world.kv.set("remover", String(e.by || ""));
  world.kv.set("beholders", "{}");
  lamp(DEAD_I);
  publish();
  world.log("removed by", e.by, "— its lips are dead, its hands hang down");
});

// Presence: lit while a beholder is near, latent while none is. Transitions
// only. The dead and the unformed are not touched by anyone's nearness.
world.every(1, () => {
  if (state() !== "alive") return;
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const b = beholders();
  const near = world.people().some((q) => q.pos && b[q.id] && dist(q.pos, me.pos) <= NEAR_M);
  lamp(near ? LIT_I : LATENT_I);
});

// Cold start / rebind: restore the lamp to the state the kv remembers.
lamp(state() === "alive" ? LATENT_I : DEAD_I);
publish();
world.log("formkeeper bound —", state());
