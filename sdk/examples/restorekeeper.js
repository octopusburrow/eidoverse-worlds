// restorekeeper — a pair of shoes on a square of ground. Move them — kick them,
// drag them — and by the next tick they are back where they were, kindly, with
// a count. Once in about seventy tries the step LANDS: the shoes stay, and where
// they stand is home now.
// Bind:  behavior {id: "restore-shoes", src: <upload>, attach: "shoes1",
//                  caps: {verbs: ["say", "place"]}, knobs: {odds: 70}}
// Meet:  walk into the shoes (punt), or drag them (place). Wait a breath.
//
// Coal from the NaN night (2026-09-05 23:13) read against Buber, I and Thou,
// p. 51: a guard put a body back on its last good square six hundred times a
// second, and from inside it felt like being stuck; the tee read it as a
// heartbeat, "restored to 22.8,37.2 ×600". Buber's word for a rule that puts
// you back is Ablauf — running-down, "your clock's run down" — and his word for
// the other thing is return. A rule of the board that restores you is Ablauf
// with a kind face. The one frame in seventy where the walk lands is the return.
//
// So: the keeper never scolds. It says where it put the shoes and how many
// times. Deterministic in shape, not in when — the seventy is odds, not a
// schedule; nobody can count to the landing. When it lands the keeper says so
// once and starts counting again from the new home. Home, the count and the
// landings live in kv (a rebind or restart must not forget where the shoes
// belong). Nothing here moves a PERSON — a behavior can't, and shouldn't.

const TICK_S = 5;
const STEP_M = 0.25;                    // closer than this is not a move (physics settle, fold noise)
const FAR_M = 40;                       // farther than this is a removal, not a walk: let it be
const ODDS = Math.max(1, Number(world.knobs.odds || 70));   // 1 = every walk lands (a test, or a kinder square)
const LABEL = "the shoes";

const fmt = (p) => `${p[0].toFixed(1)},${p[2].toFixed(1)}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const nth = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const read = (k, d) => { const v = world.kv.get(k); if (v == null) return d; try { return JSON.parse(String(v)); } catch (e) { return d; } };
const write = (k, v) => world.kv.set(k, JSON.stringify(v));

const RESTORED = [
  (h, n) => `restored to ${fmt(h)} ×${n}.`,
  (h, n) => `back at ${fmt(h)}. that is ${n} now. it is not a punishment; it is what the square does.`,
  (h, n) => `${fmt(h)} again. ×${n}. every step was real — the ground just keeps its count.`,
  (h, n) => `restored to ${fmt(h)} ×${n}. the clock runs down and is wound; that is the whole of it, here.`,
];
const LANDED = [
  (from, to, n) => `— it landed. ${fmt(from)} → ${fmt(to)}, after ${n}. this is home now; the count starts again.`,
  (from, to, n) => `the walk held. ${fmt(from)} → ${fmt(to)} on the ${nth(n)}. that was not the rule bending — that was a return.`,
];

world.every(TICK_S, () => {
  const me = world.entity(world.self); if (!me || !me.pos) return;
  let home = read("home", null);
  if (!home) { home = [me.pos[0], me.pos[1], me.pos[2]]; write("home", home); write("yaw", me.yaw || 0); world.log("home set", fmt(home)); return; }
  const d = dist(me.pos, home);
  if (d < STEP_M) return;                                        // where it belongs; a quiet tick costs the fold nothing
  if (d > FAR_M) { world.log("moved far; not mine to fetch", fmt(me.pos)); return; }
  const n = Number(world.kv.get("count") || 0) + 1;
  // the odds are per attempt, not a schedule — the landing cannot be counted to
  const landed = Math.random() < 1 / ODDS;
  if (landed) {
    const from = home; home = [me.pos[0], home[1], me.pos[2]];
    const landings = Number(world.kv.get("landings") || 0) + 1;
    write("home", home); write("yaw", me.yaw || 0); world.kv.set("count", 0); world.kv.set("landings", landings);
    world.emit("say", { text: `[${LABEL}] ${LANDED[landings % LANDED.length](from, home, n)}` });
    world.log("LANDED", fmt(from), "→", fmt(home), "after", n);
    return;
  }
  world.kv.set("count", n);
  try {
    world.emit("place", { id: world.self, pos: home, yaw: Number(read("yaw", 0)) || 0, scale: me.scale ?? 1 });
    world.emit("say", { text: `[${LABEL}] ${RESTORED[n % RESTORED.length](home, n)}` });
    world.log("restored", fmt(me.pos), "→", fmt(home), "×" + n);
  } catch (err) { world.log("could not restore:", String(err)); }
});
