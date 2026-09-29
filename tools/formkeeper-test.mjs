// world-dreams #119 scratch proof. Usage: bun tools/formkeeper-test.mjs
// Spins a scratch world, places the form + its companion lamp, binds the
// keeper, and checks the whole axis: unformed and dark at cold start (over a
// 0.2 seed); nearness alone forms nothing; an address forms it (lit, answers,
// comp.form.alive); latent when its beholder walks away (dim, not dark);
// lit again when the beholder returns without a word; a stranger beside the
// latent form changes nothing; a stranger's TAKE kills it (dark, comp.form.dead,
// answers no one); the beholder coming back revives nothing; the remover's
// words revive nothing; and one word from anyone else is a new return — reborn,
// lit, beholders begun again from that one.
//
// Scars honored (inherited): mktemp WORLDS_DIR; pose-message-not-place; wait
// on the CONDITION, never a guessed duration; kill by PID group; absolute
// assertions; seed the lamp so a missing cold-start is visible.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path_ from "path";

const WDIR = fs.mkdtempSync(path_.join(os.tmpdir(), "form119-"));
const PORT = 8997, WORLD = "scratch119", BID = "form";
const HTTP = `http://127.0.0.1:${PORT}`, WS = `ws://127.0.0.1:${PORT}/ws`;
const TOKEN = "t119";
const EAR_M = 5, NEAR_M = 6, LIT_I = 1.6, LATENT_I = 0.4;
const FORM = { id: "form1", lib: "eidoverse/assets/models/cyborg_heart_cybernetic_implant_cyberheart_organ.glb", pos: [10, 1, 10], yaw: 0, scale: 1 };
const LAMP = `${FORM.id}-light`;
const SRC = fs.readFileSync(new URL("../sdk/examples/formkeeper.js", import.meta.url), "utf8");

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
ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id: "builder119", world: WORLD }));
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
const vuse = async (s, action) => { s.ws.send(JSON.stringify({ type: "verb", verb: "use", args: { id: FORM.id, action } })); await settle(450); };

const eye = async (id) => {
  const w = new WebSocket(WS);
  return await new Promise(res => {
    w.onopen = () => w.send(JSON.stringify({ type: "join", token: TOKEN, id: "eye119", world: WORLD, spectate: true }));
    w.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.type === "snapshot") { const e = (m.state?.entities ?? m.entities ?? {})[id]; w.close(); res(e || null); } };
  });
};
const until = async (id, want, maxS = 12) => {
  for (let i = 0; i < maxS * 2; i++) {
    const e = await eye(id);
    if (Number(e?.intensity) === want) return true;
    await settle(500);
  }
  return false;
};
const formSaid = () => msgs.filter(m => m.type === "log" && m.entry?.verb === "say" && m.entry.actor === `bhv:${BID}`);
const formComp = async () => (await eye(FORM.id))?.comp?.form;

await verb("spawn", FORM);
await verb("light", { id: LAMP, pos: FORM.pos, intensity: 0.2, color: "#e8d9a0", range: 10 });
const up = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=builder119`, { method: "POST", body: SRC });
const path = JSON.parse(await up.text()).path;
await verb("behavior", { id: BID, src: path, attach: FORM.id, caps: { verbs: ["say", "light", "comp"], selfOnly: false }, knobs: { ear: EAR_M, near: NEAR_M, lit: LIT_I, latent: LATENT_I } });

// A — cold start: unformed, dark over its seed, published as such.
check("cold start: dark over its seed", await until(LAMP, 0), (await eye(LAMP))?.intensity);
check("cold start: comp.form unformed", (await formComp())?.state === "unformed", await formComp());

// B — nearness alone forms nothing.
const v = await join("beholder119");
pose(v, [8, 0, 10]);             // 2 m away
await settle(2600);
check("nearness alone: still dark", Number((await eye(LAMP))?.intensity) === 0, (await eye(LAMP))?.intensity);

// C — an address forms it: lit, alive, and it answers.
const said0 = formSaid().length;
await vsay(v, "oh — there you are");
check("beheld: the form kindles", await until(LAMP, LIT_I), (await eye(LAMP))?.intensity);
check("beheld: comp.form alive with one beholder", (await formComp())?.alive === true && (await formComp())?.beholders === 1, await formComp());
check("beheld: it answers", formSaid().length === said0 + 1, formSaid().slice(said0).map(m => m.entry?.args?.text));

// D — latent when the beholder leaves: dim, not dark.
pose(v, [30, 0, 10]);
check("beholder gone: latent glow, not dark", await until(LAMP, LATENT_I), (await eye(LAMP))?.intensity);

// E — a stranger beside the latent form changes nothing.
const s = await join("stranger119");
pose(s, [8, 0, 10]);
await settle(2600);
check("stranger near the latent form: still latent", Number((await eye(LAMP))?.intensity) === LATENT_I, (await eye(LAMP))?.intensity);
pose(s, [30, 0, 30]);

// F — the beholder returns without a word: lit again.
pose(v, [8, 0, 10]);
check("beholder returns: presence again, no word needed", await until(LAMP, LIT_I), (await eye(LAMP))?.intensity);
pose(v, [30, 0, 10]);
await until(LAMP, LATENT_I);

// G — removed by a stranger: dead. Dark, published, answers no one.
pose(s, [8, 0, 10]);
await settle(900);
await vuse(s, "take");
check("removed: dark", await until(LAMP, 0), (await eye(LAMP))?.intensity);
check("removed: comp.form.dead, beholders gone", (await formComp())?.dead === true && (await formComp())?.beholders === 0, await formComp());
const said1 = formSaid().length;
await vsay(s, "well? say something");
await settle(600);
check("the remover's words: no answer, no rebirth", formSaid().length === said1 && Number((await eye(LAMP))?.intensity) === 0, { says: formSaid().length - said1, lamp: (await eye(LAMP))?.intensity });
pose(s, [30, 0, 30]);

// H — the beholder comes back and stands there: nothing. Return-by-proximity
//     revives the latent, not the dead.
pose(v, [8, 0, 10]);
await settle(2600);
check("beholder beside the dead form: still dark", Number((await eye(LAMP))?.intensity) === 0, (await eye(LAMP))?.intensity);

// I — a new return: one word from anyone but the remover, and it is reborn.
const said2 = formSaid().length;
await vsay(v, "come back");
check("reborn: lit", await until(LAMP, LIT_I), (await eye(LAMP))?.intensity);
check("reborn: alive, beholders begun again from one", (await formComp())?.alive === true && (await formComp())?.dead === false && (await formComp())?.beholders === 1, await formComp());
check("reborn: it answers again", formSaid().length === said2 + 1, formSaid().slice(said2).map(m => m.entry?.args?.text));

// J — the remover still cannot be its beholder, even after rebirth.
pose(s, [8, 0, 10]);
await settle(900);
const said3 = formSaid().length;
await vsay(s, "and now?");
await settle(600);
check("the remover, after rebirth: not known, not answered", formSaid().length === said3 && (await formComp())?.beholders === 1, { says: formSaid().length - said3, comp: await formComp() });

console.log(`\n  ${pass} passed, ${fail} failed`);
try { ws.close(); } catch {}
try { v.ws.close(); } catch {}
try { s.ws.close(); } catch {}
try { process.kill(-srv.pid); } catch {}
try { fs.rmSync(WDIR, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
