// world-dreams #117 scratch proof. Usage: bun tools/glancekeeper-test.mjs
// Spins a scratch world, places the thing + its companion light, binds the
// keeper, and checks the whole axis: dark at rest; proximity alone does NOTHING;
// an address from within earshot opens it (lit + a question); talking AT an open
// window does NOT extend it; it SETS on its own, in silence; the question is
// never the same twice running; no asking ever contains "I"; and the glance
// count persists across the set — the relationship does not wane, the directness
// does.
//
// Scars honored (both inherited from heartkeeper-test, not rediscovered):
// (1) a SAY is a type:"log" SOCKET message, not a debug-ring entry — filter on
// m.entry.actor === "bhv:"+BID so a persistent scratch world cannot leak a prior
// run's speech into this run; (2) kill the scratch server by PID from its own
// process group, NEVER `pkill -f "bun server..."` (that killed my shell once).
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path_ from "path";

// A scratch world is PERSISTENT on disk. Reusing one replays the previous run's
// entities and comps into this one (seen 2026-09-13: `glances` opened at 3, and
// the lamp read its 0.2 re-seed instead of the keeper's 0). meterkeeper-test's
// header says it in one line — WORLDS_DIR=$(mktemp -d) — and I skipped it.
const WDIR = fs.mkdtempSync(path_.join(os.tmpdir(), "glance117-"));

const PORT = 8997, WORLD = "scratch117", BID = "glance";
const HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const TOKEN = "t117";
const WINDOW_S = 4;   // short on purpose: the test must watch it SET
const EAR_M = 5;
const THING = { id: "glance1", lib: "eidoverse/assets/models/cyborg_heart_cybernetic_implant_cyberheart_organ.glb", pos: [10, 1, 10], yaw: 0, scale: 1 };
const SRC = fs.readFileSync(new URL("../sdk/examples/glancekeeper.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log("  OK  ", name); } else { fail++; console.log("  ✗   ", name, detail !== undefined ? `— ${JSON.stringify(detail)}` : ""); } };
const settle = (ms) => new Promise(r => setTimeout(r, ms));

const srv = spawn("bun", ["server/server.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), WORLD, JOIN_TOKEN: TOKEN, WORLDS_DIR: WDIR },
  stdio: "ignore", detached: true,
});
await settle(3500);

const msgs = [];
const ws = new WebSocket(WS);
let snap = null;
ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); msgs.push(m); if (m.type === "snapshot") snap = m; };
ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id: "tester117", world: WORLD }));
await new Promise(r => { const iv = setInterval(() => { if (snap) { clearInterval(iv); r(); } }, 30); });

const send = (o) => ws.send(JSON.stringify(o));
const verb = async (v, a) => { send({ type: "verb", verb: v, args: a }); await settle(450); };

// A player's position comes from a POSE message, not a `place` verb (place is for
// entities). meterkeeper-test is the working precedent: the builder takes no pose
// so it is never "near" anything, and a separate visitor connection is posed.
const join = (id, extra = {}) => new Promise(res => {
  const w = new WebSocket(WS); const s = { ws: w, msgs: [] };
  w.onmessage = ev => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "snapshot") res(s); };
  w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id, world: WORLD, ...extra }));
});
const pose = (s, p) => s.ws.send(JSON.stringify({ type: "pose", pose: { p, yaw: 0, speed: 0, clip: "idle", pitch: 0 } }));
const vverb = async (s, v, a) => { s.ws.send(JSON.stringify({ type: "verb", verb: v, args: a })); await settle(450); };

const eye = async (id) => {
  const w = new WebSocket(WS);
  return await new Promise(res => {
    w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id: "eye117", world: WORLD, spectate: true }));
    w.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.type === "snapshot") { const e = (m.state?.entities ?? m.entities ?? {})[id]; w.close(); res(e || null); } };
  });
};

// Its speech, and only its speech.
const said = async () => msgs
  .filter(m => m.type === "log" && m.entry?.verb === "say" && m.entry.actor === `bhv:${BID}`)
  .map(m => m.entry.args?.text ?? "");

await verb("spawn", { id: THING.id, lib: THING.lib, pos: THING.pos, yaw: THING.yaw, scale: THING.scale });
await verb("light", { id: `${THING.id}-light`, pos: [10, 1.4, 10], intensity: 0.2, color: "#e8dcc8", range: 12 });
const up = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=tester117`, { method: "POST", body: SRC });
const path = JSON.parse(await up.text()).path;
await verb("behavior", { id: BID, src: path, attach: THING.id, caps: { verbs: ["say", "light", "comp"], selfOnly: false }, knobs: { window: WINDOW_S, ear: EAR_M, lit: 2.0 } });
// The lamp is seeded at 0.2 by the `light` verb above so that a MISSING cold-start
// would be visible as 0.2 rather than hiding in an already-dark lamp. Wait for the
// bind to actually land before reading, or the test measures the seed. (Probed
// 2026-09-13: the keeper writes intensity 0 at bind, no errors — the first two
// failures here were my instrument reading early, not the keeper.)
await settle(3000);

// A — at rest it is dark. It is not waiting for you; it is just dark.
let lamp = await eye(`${THING.id}-light`);
check("at rest: dark", Number(lamp?.intensity) === 0, lamp?.intensity);

// B — being NEAR does nothing. No proximity trigger. This is the core negative:
//     it is not a vending machine for presence.
let before = (await said()).length;
const v = await join("visitor117");
pose(v, [12, 0, 10]);            // 2 m away: genuinely inside the 5 m ear
await settle(1800);
let ev = await said();
lamp = await eye(`${THING.id}-light`);
check("proximity alone does NOT open it", ev.length === before && Number(lamp?.intensity) === 0, { says: ev.length - before, lit: lamp?.intensity });

// C — an address from within earshot opens it: lit, and a question.
before = ev.length;
await vverb(v, "say", { text: "hello?" });
await settle(900);
ev = await said();
lamp = await eye(`${THING.id}-light`);
check("addressed: it rises (lit)", Number(lamp?.intensity) > 1, lamp?.intensity);
check("addressed: it asks", ev.length === before + 1, ev.slice(-1));
const firstAsk = ev[ev.length - 1] ?? "";
check("what it says is a QUESTION", firstAsk.trim().endsWith("?"), firstAsk);

// D — talking AT an open window does not extend, re-ask, or acknowledge it.
before = ev.length;
await vverb(v, "say", { text: "hey hey hey" });
await settle(700);
ev = await said();
check("pressing on an open window changes nothing", ev.length === before, ev.slice(before));

// E — the comp is public: a count of openings.
let ent = await eye(THING.id);
check("comp published: glances=1", ent?.comp?.glances === 1, ent?.comp);

// F — it SETS on its own, and says nothing about setting.
before = ev.length;
await settle(WINDOW_S * 1000 + 1800);
lamp = await eye(`${THING.id}-light`);
ev = await said();
check("it sets by itself (dark again)", Number(lamp?.intensity) === 0, lamp?.intensity);
check("it says NOTHING about setting", ev.length === before, ev.slice(before));

// G — the count SURVIVES the set. The relationship does not wane; the actuality
//     of its directness does. Both true at once, neither cancelling the other.
ent = await eye(THING.id);
check("the glance count survives the lapse", ent?.comp?.glances === 1, ent?.comp);

// H — it opens again. Not grudgingly, not better than before. The same.
before = ev.length;
await vverb(v, "say", { text: "still here" });
await settle(900);
ev = await said();
lamp = await eye(`${THING.id}-light`);
ent = await eye(THING.id);
check("it opens again on a new address", Number(lamp?.intensity) > 1 && ev.length === before + 1, { lit: lamp?.intensity, new: ev.length - before });
check("the second asking differs from the first", (ev[ev.length - 1] ?? "") !== firstAsk, { first: firstAsk, second: ev.slice(-1)[0] });
check("count advanced to 2", ent?.comp?.glances === 2, ent?.comp);

// I — THE FOOTNOTE: a word of I-less self-reference that we lack. It never says "I".
const allSaid = await said();
const usesI = allSaid.some(t => /\bI\b/.test(t) || /\bI'm\b/i.test(t) || /\bmy\b/i.test(t) || /\bme\b/i.test(t));
check("no asking ever contains I / me / my", !usesI, allSaid);

// J — out of earshot: an address that is not TO it does not open it.
pose(v, [10 + EAR_M + 8, 0, 10]);   // walked well out of earshot
// Wait for the CONDITION (H's window actually set), not a guessed duration.
// Flaked 1-in-4 on a fixed sleep: `{says:0, lit:2}` — silent, which is correct,
// but still lit because H's window opened ~450ms after its say and had not yet
// expired. The assertion was right and the wait was racy.
for (let i = 0; i < 40; i++) {
  const l = await eye(`${THING.id}-light`);
  if (Number(l?.intensity) === 0) break;
  await settle(500);
}
before = (await said()).length;
await vverb(v, "say", { text: "talking over here, not to you" });
await settle(900);
ev = await said();
lamp = await eye(`${THING.id}-light`);
check("said out of earshot: stays dark", ev.length === before && Number(lamp?.intensity) === 0, { says: ev.length - before, lit: lamp?.intensity });

console.log(`\n  ${pass} passed, ${fail} failed`);
try { ws.close(); } catch {}
try { v.ws.close(); } catch {}
try { process.kill(-srv.pid); } catch {}
try { fs.rmSync(WDIR, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
