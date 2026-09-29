// world-dreams #118 scratch proof. Usage: bun tools/wellkeeper-test.mjs
// Spins a scratch world, places the well + two hearths, binds the keeper, and
// checks the whole axis: hearths dark at cold start (over a 0.2 seed, so a
// missing cold-start is visible); nearness confers nothing; ASKING confers
// nothing; a plain address confers — with zero acknowledgment at the well —
// and the gift appears only elsewhere (the hearth kindles for the conferred,
// stays dark for everyone else); it sets behind them; the lease lapses in
// silence; accepting again renews it; asking after accepting revokes nothing;
// and the well never says one word the entire run (its caps have no mouth).
//
// Scars honored (inherited from glancekeeper/meterkeeper, not rediscovered):
// (1) WORLDS_DIR=$(mktemp -d) — a scratch world is persistent and replays prior
//     runs into your assertions; (2) a player's position is a POSE message, not
//     a `place` verb; (3) wait on the CONDITION, never a guessed duration — the
//     09-13 flake was a racy sleep, not a bug; (4) kill the server by PID from
//     its own process group, never pkill a pattern you're typing.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path_ from "path";

const WDIR = fs.mkdtempSync(path_.join(os.tmpdir(), "well118-"));
const PORT = 8996, WORLD = "scratch118", BID = "well";
const HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const TOKEN = "t118";
const EAR_M = 5, NEAR_M = 4, LEASE_S = 8, LIT_I = 1.6;
const WELL = { id: "well1", lib: "eidoverse/assets/models/cyborg_heart_cybernetic_implant_cyberheart_organ.glb", pos: [10, 1, 10], yaw: 0, scale: 1 };
const H1 = { id: "hearth1", pos: [30, 1.4, 10] };   // 20 m from the well
const H2 = { id: "hearth2", pos: [10, 1.4, 30] };   // 20 m the other way
const SRC = fs.readFileSync(new URL("../sdk/examples/wellkeeper.js", import.meta.url), "utf8");

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
ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id: "builder118", world: WORLD }));
await new Promise(r => { const iv = setInterval(() => { if (snap) { clearInterval(iv); r(); } }, 30); });

const send = (o) => ws.send(JSON.stringify(o));
const verb = async (v, a) => { send({ type: "verb", verb: v, args: a }); await settle(450); };

const join = (id) => new Promise(res => {
  const w = new WebSocket(WS); const s = { ws: w, msgs: [] };
  w.onmessage = ev => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "snapshot") res(s); };
  w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id, world: WORLD }));
});
const pose = (s, p) => s.ws.send(JSON.stringify({ type: "pose", pose: { p, yaw: 0, speed: 0, clip: "idle", pitch: 0 } }));
const vsay = async (s, text) => { s.ws.send(JSON.stringify({ type: "verb", verb: "say", args: { text } })); await settle(450); };

const eye = async (id) => {
  const w = new WebSocket(WS);
  return await new Promise(res => {
    w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id: "eye118", world: WORLD, spectate: true }));
    w.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.type === "snapshot") { const e = (m.state?.entities ?? m.entities ?? {})[id]; w.close(); res(e || null); } };
  });
};
// Wait on the CONDITION, never a guessed duration.
const until = async (id, want, maxS = 12) => {
  for (let i = 0; i < maxS * 2; i++) {
    const e = await eye(id);
    if (Number(e?.intensity) === want) return true;
    await settle(500);
  }
  return false;
};
const wellSaid = () => msgs.filter(m => m.type === "log" && m.entry?.verb === "say" && m.entry.actor === `bhv:${BID}`);

await verb("spawn", WELL);
// Hearths seeded at 0.2 so a MISSING cold-start reads as 0.2, not as an
// accidental pass inside an already-dark lamp (glancekeeper's trick, kept).
await verb("light", { id: H1.id, pos: H1.pos, intensity: 0.2, color: "#e8b86a", range: 12 });
await verb("light", { id: H2.id, pos: H2.pos, intensity: 0.2, color: "#e8b86a", range: 12 });
const up = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=builder118`, { method: "POST", body: SRC });
const path = JSON.parse(await up.text()).path;
await verb("behavior", { id: BID, src: path, attach: WELL.id, caps: { verbs: ["light"], selfOnly: false }, knobs: { ear: EAR_M, near: NEAR_M, lease: LEASE_S, lit: LIT_I, hearths: `${H1.id},${H2.id}` } });

// A — cold start: both hearths dark (0, not the 0.2 seed).
check("cold start: hearth1 dark over its seed", await until(H1.id, 0), (await eye(H1.id))?.intensity);
check("cold start: hearth2 dark over its seed", await until(H2.id, 0, 4), (await eye(H2.id))?.intensity);

// B — nearness confers nothing: an unconferred visitor at the hearth, dark.
const v = await join("visitor118");
pose(v, [28, 0, 10]);            // 2 m from hearth1
await settle(2600);
check("unconferred at the hearth: dark", Number((await eye(H1.id))?.intensity) === 0, (await eye(H1.id))?.intensity);

// C — ASKING confers nothing. "One accepts, one does not ask who gives."
pose(v, [8, 0, 10]);             // 2 m from the well, inside the 5 m ear
await settle(900);
await vsay(v, "who gives this?");
await settle(900);
pose(v, [28, 0, 10]);            // back to hearth1
await settle(2600);
check("asking conferred nothing: hearth stays dark", Number((await eye(H1.id))?.intensity) === 0, (await eye(H1.id))?.intensity);

// D — a plain address confers, with ZERO acknowledgment at the well, and the
//     gift appears only elsewhere: hearth1 kindles when the conferred arrives.
pose(v, [8, 0, 10]);
await settle(900);
const saysBefore = wellSaid().length;
await vsay(v, "thank you");
await settle(900);
check("acceptance is not acknowledged at the well", wellSaid().length === saysBefore, wellSaid().slice(saysBefore));
const wellEnt = await eye(WELL.id);
check("no readable mark of conferral on the well", !wellEnt?.comp || Object.keys(wellEnt.comp).length === 0, wellEnt?.comp);
pose(v, [28, 0, 10]);
check("the hearth kindles for the conferred", await until(H1.id, LIT_I), (await eye(H1.id))?.intensity);
check("the other hearth does not", Number((await eye(H2.id))?.intensity) === 0, (await eye(H2.id))?.intensity);

// E — it sets behind them. The strength is walked, not owned.
pose(v, [20, 0, 20]);            // away from both
check("the hearth sets when the conferred leaves", await until(H1.id, 0), (await eye(H1.id))?.intensity);

// F — it cannot be handed on: a second visitor, never conferred, gets nothing.
const v2 = await join("visitor118b");
pose(v2, [28, 0, 10]);
await settle(2600);
check("another's presence kindles nothing", Number((await eye(H1.id))?.intensity) === 0, (await eye(H1.id))?.intensity);
pose(v2, [50, 0, 50]);           // and leaves the stage

// G — the lease lapses in silence. (Conferred at D; LEASE_S long since spent.)
pose(v, [28, 0, 10]);
await settle(3200);
check("the lease has lapsed: dark for the once-conferred", Number((await eye(H1.id))?.intensity) === 0, (await eye(H1.id))?.intensity);

// H — renewal: accept again, and asking right after revokes nothing.
//     "...and the measure of each day, daily."
pose(v, [8, 0, 10]);
await settle(900);
await vsay(v, "here, gladly");
await vsay(v, "why does this work?");   // an asking, after accepting
await settle(600);
pose(v, [28, 0, 10]);
check("accepting again renews the strength", await until(H1.id, LIT_I), (await eye(H1.id))?.intensity);

// I — the well has no mouth: not one say from the behavior, the entire run.
check("the well never says a word", wellSaid().length === 0, wellSaid().map(m => m.entry?.args?.text));

console.log(`\n  ${pass} passed, ${fail} failed`);
try { ws.close(); } catch {}
try { v.ws.close(); } catch {}
try { v2.ws.close(); } catch {}
try { process.kill(-srv.pid); } catch {}
try { fs.rmSync(WDIR, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
