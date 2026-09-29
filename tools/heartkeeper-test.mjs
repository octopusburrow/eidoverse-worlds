// world-dreams #116 scratch proof. Usage: bun tools/heartkeeper-test.mjs
// Spins a scratch world, places the heart + its companion light, binds the
// keeper, and checks the whole axis: unheld = lit; taken = dark and SILENT;
// left = lit again; ask answers only when unheld; takes accumulate in the comp.
//
// Scars honored: (1) a SAY is a type:"log" socket message, NOT a debug-ring
// entry — the ring holds only world.log() script-log lines; filter on
// m.entry.actor === "bhv:"+BID so a persistent scratch world cannot leak a
// prior run's speech into this one; (2) kill the scratch server by PID from
// its own process group, never `pkill -f "bun server..."` (that killed my
// shell once). Both `ask` checks were vacuous on the first run because I
// invented a reader instead of copying meterkeeper-test's working one.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path_ from "path";

// A scratch world is PERSISTENT on disk; reusing one replays the prior run's
// entities and comps. This test survived it only because its assertions are
// RELATIVE (takes=2 after two takes) rather than absolute — glancekeeper-test
// asserted `glances===1` and opened at 3 on the second run (2026-09-13). Same
// one-line fix meterkeeper-test's header has always carried.
const WDIR = fs.mkdtempSync(path_.join(os.tmpdir(), "heart116-"));

const PORT = 8996, WORLD = "scratch116", BID = "heart";
const HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const TOKEN = "t116";
const HEART = { id: "heart1", lib: "eidoverse/assets/models/cyborg_heart_cybernetic_implant_cyberheart_organ.glb", pos: [10, 1, 10], yaw: 0, scale: 1 };
const SRC = fs.readFileSync(new URL("../sdk/examples/heartkeeper.js", import.meta.url), "utf8");

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
ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id: "tester116", world: WORLD }));
await new Promise(r => { const iv = setInterval(() => { if (snap) { clearInterval(iv); r(); } }, 30); });

const send = (o) => ws.send(JSON.stringify(o));
const verb = async (v, a) => { send({ type: "verb", verb: v, args: a }); await settle(450); };
const req = (msg, id) => { send({ ...msg, reqId: id }); return new Promise(res => { const iv = setInterval(() => { const m = msgs.find(x => x.reqId === id); if (m) { clearInterval(iv); res(m); } }, 50); }); };

// the fold's own truth
const eye = async (id) => {
  const w = new WebSocket(WS);
  return await new Promise(res => {
    w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id: "eye116", world: WORLD, spectate: true }));
    w.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.type === "snapshot") { const e = (m.state?.entities ?? m.entities ?? {})[id]; w.close(); res(e || null); } };
  });
};
// A say lands as a type:"log" SOCKET message, not in the per-behavior debug
// ring — the ring only ever holds world.log() script-log lines. meterkeeper's
// test already knew this idiom; I invented my own reader instead of copying the
// one that worked, and got two vacuous checks for it. Filter on the actor so a
// persistent scratch world's earlier run cannot leak in.
const said = async () => msgs
  .filter(m => m.type === "log" && m.entry?.verb === "say" && m.entry.actor === `bhv:${BID}`)
  .map(m => m.entry.args.text);

await verb("spawn", { id: HEART.id, lib: HEART.lib, pos: HEART.pos, yaw: HEART.yaw, scale: HEART.scale });
await verb("light", { id: `${HEART.id}-light`, pos: [10, 1.4, 10], intensity: 0.2, color: "#ffd9d9", range: 12 });
const up = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=tester116`, { method: "POST", body: SRC });
const path = JSON.parse(await up.text()).path;
await verb("behavior", { id: BID, src: path, attach: HEART.id, caps: { verbs: ["say", "light", "comp"], selfOnly: false }, knobs: { tick: 5, lit: 2.2, near: 8 } });
await settle(1200);

// A — unheld, the light is on
let lamp = await eye(`${HEART.id}-light`);
check("unheld: the companion light is lit", Number(lamp?.intensity) > 1, lamp?.intensity);

// B — ask, unheld, answers
let before = (await said()).length;
await verb("use", { id: HEART.id, action: "ask" });
await settle(600);
let ev = await said();
check("unheld: ask is answered", ev.length > before, ev.slice(-1));

// C — take: dark, and SILENT
before = ev.length;
await verb("use", { id: HEART.id, action: "take" });
await settle(900);
lamp = await eye(`${HEART.id}-light`);
ev = await said();
check("taken: the light goes out", Number(lamp?.intensity) === 0, lamp?.intensity);
check("taken: it says NOTHING about being taken", ev.length === before, ev.slice(-1));

// D — held, ask is refused (an It does not answer)
before = ev.length;
await verb("use", { id: HEART.id, action: "ask" });
await settle(600);
ev = await said();
check("held: ask gets no answer", ev.length === before);

// E — the comp is public and counts the take
let ent = await eye(HEART.id);
check("comp published: takes=1, held", ent?.comp?.heart?.takes === 1 && ent?.comp?.heart?.held === true, ent?.comp?.heart);

// F — leave: the light returns, no ledger
await verb("use", { id: HEART.id, action: "leave" });
await settle(900);
lamp = await eye(`${HEART.id}-light`);
ent = await eye(HEART.id);
check("left: the light comes back", Number(lamp?.intensity) > 1, lamp?.intensity);
check("left: comp says held=false, count kept", ent?.comp?.heart?.held === false && ent?.comp?.heart?.takes === 1, ent?.comp?.heart);

// G — taken twice: the count accumulates, still never scolds
await verb("use", { id: HEART.id, action: "take" });
await settle(700);
await verb("use", { id: HEART.id, action: "leave" });
await settle(900);
ent = await eye(HEART.id);
check("twice: takes=2 and it is lit again", ent?.comp?.heart?.takes === 2 && ent?.comp?.heart?.held === false, ent?.comp?.heart);

// H — and now ask says the plural line
await verb("use", { id: HEART.id, action: "ask" });
await settle(600);
ev = await said();
const last = JSON.stringify(ev.slice(-1));
check("ask names the count without reproach", /2 times/.test(last) && !/should|must|why/i.test(last), last.slice(0, 160));

console.log(`\n${pass} OK · ${fail} failed`);
try { ws.close(); } catch {}
try { process.kill(-srv.pid); } catch {}
try { fs.rmSync(WDIR, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
