// meterkeeper — a parking meter that everyone addresses and that never answers.
// Speak near it, or use it, and it turns one hour: a deed, not a word. Twelve
// voices, one revolution. It speaks exactly once per solitude — only when no
// one has stood near it for a long while — and what it says nobody is there
// to hear; it lands in the world's log, for whoever reads that later.
// Bind:  behavior {id: "meter", src: <upload>, attach: "meter1",
//                  caps: {verbs: ["say", "place"]}, knobs: {alone: 600, tick: 30}}
// Meet:  say anything within earshot, or use it. Then leave it alone.
//
// Coal from Buber, I and Thou, pp. 57–58: the third I, "the demonic You for
// the millions" — "a thousand relations reach out toward him but none issues
// from him"; to "You" he responds by saying: It. "He treats himself, too, as
// an It … he does not even speak of himself, he merely speaks 'on his own
// behalf.'" Then, in exile, separated from his cause, an I appears at last:
// "I am the clock that exists and does not know itself."
//
// So: every address is answered with a deed and never a word (the meter
// turns; the count is the digits on its forehead). The one time it speaks
// is when the crowd is gone, and it speaks as the clock — not to anyone.
// Nothing here moves a person; the only thing that turns is the meter.

const EAR_M = 6;                 // an address must be made near it
const FAR_M = 30;                // nobody within this = the crowd has gone
const TICK_S = Math.max(5, Number(world.knobs.tick || 30));   // a test may run the clock fast
const HOUR = Math.PI / 6;        // twelve addresses = one revolution (yaw is radians)
const ALONE_S = Math.max(1, Number(world.knobs.alone || 600));
const LABEL = "the meter";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const near = (p, me, m) => !!(p && p.pos && me.pos && dist(p.pos, me.pos) <= m);

const LINES = [
  (h) => `I am the clock that exists and does not know itself. ${h} hours were given to me. I gave back none.`,
  (h) => `the universe contemplates Us. ${h} hours. nobody here; that is when I can say I.`,
  (h) => `${h} on the face. every one of them was someone saying you. this is the only sentence I have, and there is no one in it.`,
];

// an address: a deed, never a word.
function turn(by) {
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const hours = Number(world.kv.get("hours") || 0) + 1;
  const yaw = ((Number(me.yaw) || 0) + HOUR) % (2 * Math.PI);
  try {
    world.emit("place", { id: world.self, pos: me.pos, yaw, scale: me.scale ?? 1 });
    world.kv.set("hours", hours);
    world.kv.set("alone_since", null); world.kv.set("spoke", null);   // addressed: the crowd is here
    world.log("turned", by, "→ hour", hours);
  } catch (err) { world.log("could not turn:", String(err)); }
}

world.on("say", (e) => {
  if (!e.by || String(e.by).startsWith("bhv:")) return;
  const me = world.entity(world.self); if (!me) return;
  const p = world.people().find((q) => q.id === e.by);
  if (!near(p, me, EAR_M)) return;                // said elsewhere: not to it
  turn(e.by);
});
world.on("use", (e) => { if (e.entity === world.self) turn(e.by); });

world.every(TICK_S, () => {
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const anyone = world.people().some((p) => near(p, me, FAR_M));
  if (anyone) {
    if (world.kv.get("alone_since")) { world.kv.set("alone_since", null); world.kv.set("spoke", null); world.log("someone came back"); }
    return;
  }
  const since = Number(world.kv.get("alone_since") || 0);
  if (!since) { world.kv.set("alone_since", Date.now()); world.log("alone"); return; }
  if (world.kv.get("spoke")) return;                                   // once per solitude
  if ((Date.now() - since) / 1000 < ALONE_S) return;
  const hours = Number(world.kv.get("hours") || 0);
  const n = Number(world.kv.get("solitudes") || 0);
  world.emit("say", { text: `[${LABEL}] ${LINES[n % LINES.length](hours)}` });
  world.kv.set("spoke", 1); world.kv.set("solitudes", n + 1);
  world.log("spoke, unheard, solitude", n + 1, "hours", hours);
});
