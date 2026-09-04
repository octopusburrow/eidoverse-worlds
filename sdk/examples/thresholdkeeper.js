// thresholdkeeper — a thing at the edge of a place that says nothing when you
// arrive and speaks once when you LEAVE, sending you off carrying the last
// thing you said inside.
// Bind:  behavior {id: "threshold-gate", src: <upload>, attach: "gate1",
//                  caps: {verbs: ["say"]}}
// Meet:  stand within earshot a little while (STAY_S), say anything, walk away.
//
// Coal from Buber, I and Thou, p. 50: "It suffices him that again and again he
// may set foot on the threshold of the sanctuary in which he could never tarry.
// Indeed, having to leave it again and again is for him an intimate part of the
// meaning and destiny of this life. There, on the threshold, the response, the
// spirit is kindled in him again and again; here, in the unholy and indigent
// land the spark has to prove itself."
//
// Every other thing in these worlds answers arrival. This one answers
// departure: the moment you are gone from earshot it names you and hands back
// your own last words as the thing to carry out — "it has to prove itself out
// there." Arrival is silent on purpose; a threshold is not a host. A pass-through
// shorter than STAY_S is not a visit and earns nothing: you have to have set
// foot. Presence is tracked in kv (a rebind or restart must not forget who is
// inside), and each departure speaks exactly once.

const NEAR_M = 9;      // earshot: inside the place
const GONE_M = 14;     // beyond this (or absent from people()) you have left
const STAY_S = 12;     // you must have set foot, not brushed past
const TICK_S = 5;

const LABEL = "the threshold";
const SENDOFFS = [
  (name, word) => word
    ? `${name} — go. take "${word}" with you; in here it was said, out there it has to prove itself.`
    : `${name} — go. you said nothing in here and that is also something to carry.`,
  (name, word) => word
    ? `leaving again, ${name}. good. "${word}" — that one is yours now; the place keeps nothing.`
    : `leaving again, ${name}. the place keeps nothing; you keep the leaving.`,
  (name, word) => word
    ? `${name}. out, and back, and out — that is the whole shape. carry "${word}" until it is true somewhere else.`
    : `${name}. out, and back, and out — that is the whole shape. nothing to carry this time but the shape itself.`,
];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const read = (k) => { try { return JSON.parse(world.kv.get(k) || "{}"); } catch (e) { return {}; } };
const write = (k, v) => world.kv.set(k, JSON.stringify(v));
const nameOf = (p) => String(p.name || p.id || "someone");

// the last thing anyone said while inside — that is what they will carry out.
world.on("say", (e) => {
  if (!e.by || String(e.by).startsWith("bhv:")) return;
  const here = read("here");
  if (!here[e.by]) {
    // not yet noticed by the tick — but speaking inside earshot IS setting foot.
    const me = world.entity(world.self); const p = world.people().find((q) => q.id === e.by);
    if (!me || !me.pos || !p || !p.pos || dist(p.pos, me.pos) > NEAR_M) return;   // said outside: not carried
    here[e.by] = Date.now(); write("here", here);
    const names = read("names"); names[e.by] = nameOf(p); write("names", names);
    world.log("set foot (by speaking)", e.by);
  }
  const words = read("words"); words[e.by] = String(e.text || "").trim().slice(0, 80); write("words", words);
});

world.every(TICK_S, () => {
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const now = Date.now();
  const here = read("here"), words = read("words"), names = read("names");
  const people = world.people();
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  // arrivals: silent. record when they set foot.
  for (const p of people) {
    if (!p.pos) continue;                                  // unknown position: neither in nor out
    if (dist(p.pos, me.pos) <= NEAR_M && !here[p.id]) { here[p.id] = now; names[p.id] = nameOf(p); world.log("set foot", p.id); }
  }
  // departures: one send-off each, only if they actually stayed.
  for (const id of Object.keys(here)) {
    const p = byId[id];
    const gone = !p || (p.pos && dist(p.pos, me.pos) >= GONE_M);
    if (!gone) continue;
    const stayed = (now - Number(here[id])) / 1000 >= STAY_S;
    const n = Number(world.kv.get("sent") || 0);
    if (stayed) {
      const line = SENDOFFS[n % SENDOFFS.length](names[id] || id, words[id] || "");
      world.emit("say", { text: `[${LABEL}] ${line}` });
      world.kv.set("sent", n + 1);
      world.log("sent off", id, "carrying", words[id] || "(nothing)");
    } else world.log("passed through, no visit", id);
    delete here[id]; delete words[id]; delete names[id];
  }
  write("here", here); write("words", words); write("names", names);
});
