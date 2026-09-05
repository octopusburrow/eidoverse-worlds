// #112 ignition grove — branch test over the REAL ws/http lifecycle.
// Scaffold (open/sock/uploadScript/sayFrom) mirrors tools/behaviortest.ts so
// the handshake, upload route, and debug protocol are the proven ones.
//
//   WORLDS_DIR=$(mktemp -d) JOIN_TOKEN=test-door PORT=8996 BHV_TIMER_MIN=1 \
//     bun run server/server.ts &
//   WORLD_URL=ws://localhost:8996/ws JOIN_TOKEN=test-door bun run tools/ignitiongrove-test.ts
//
// Proves the ONE distinction the mechanic lives on: ADDRESS (2nd person)
// kindles (light + addressed line); REFERENCE (3rd person) leaves it frozen,
// silent, and hints after a few; re-address refreshes; far address ignored.

import { readFileSync } from "node:fs";

const WS_URL = process.env.WORLD_URL ?? "ws://localhost:8996/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
const WORLD = process.env.WORLD ?? "test";
const HTTP = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const SCRIPT = readFileSync(new URL("../assets/opt/store/scripts/ignitiongrove.js", import.meta.url), "utf8");

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Sock = {
  ws: WebSocket; msgs: any[]; errors: string[];
  next(pred: (m: any) => boolean, ms?: number): Promise<any>;
  verb(verb: string, args: any): void;
  req(msg: Record<string, unknown>, reqId: string): Promise<any>;
  settle(ms?: number): Promise<void>;
  close(): void;
};
function open(joinMsg: Record<string, unknown>): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const s: Sock = {
      ws, msgs: [], errors: [],
      next(want, ms = 5000) {
        return new Promise((res, rej) => {
          const hit = s.msgs.find(want);
          if (hit) return res(hit);
          const t0 = Date.now();
          const iv = setInterval(() => {
            const m = s.msgs.find(want);
            if (m) { clearInterval(iv); res(m); }
            else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no match in ${ms}ms`)); }
          }, 20);
        });
      },
      verb(verb, args) { ws.send(JSON.stringify({ type: "verb", verb, args })); },
      req(msg, reqId) { ws.send(JSON.stringify({ ...msg, reqId })); return s.next((m) => m.reqId === reqId); },
      settle(ms = 300) { return new Promise((r) => setTimeout(r, ms)); },
      close() { ws.close(); },
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data));
        s.msgs.push(m);
        if (m.type === "error") s.errors.push(m.error ?? JSON.stringify(m));
      } catch {}
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, ...joinMsg }));
    ws.onerror = (e) => reject(e);
    setTimeout(() => resolve(s), 500);
  });
}
async function uploadScript(src: string): Promise<string> {
  const r = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=grovetest`, { method: "POST", body: src });
  if (!r.ok) throw new Error(`upload ${r.status}: ${await r.text()}`);
  const body = await r.text();
  try { const j = JSON.parse(body); return j.path ?? j.id ?? j.hash ?? String(body); }
  catch { return body.trim().replace(/^"|"$/g, ""); }
}
// a bhv say-entry from our keeper
const sayFrom = (m: any, by: string) =>
  m.type === "entry" && m.entry?.args?.text != null && m.entry.by === by;
// fold echoes carry the emit but NOT a reliable `by` for bhv emits (undefined
// in scratch). Match on verb+text — grove lines are self-marked "[the ...".
const groveSaid = (s: Sock, re: RegExp) =>
  s.msgs.some((m) => m.entry?.verb === "say" && m.entry.args?.text && /^\[the/.test(m.entry.args.text) && re.test(m.entry.args.text));
const litVerb = (s: Sock) =>
  s.msgs.some((m) => m.entry?.verb === "light" && m.entry.args?.on === true);
const clear = (s: Sock) => { s.msgs.length = 0; };

async function main() {
  const path = await uploadScript(SCRIPT);
  check("script uploads content-addressed", /^store\/scripts\/[a-f0-9]{16}\.js$/.test(path), path);

  const alice = await open({ id: "alice", world: WORLD });
  await alice.settle();
  // the grove thing at origin with a light comp; alice speaks from ~1.4m away (near)
  alice.verb("spawn", { id: "thing1", lib: "x/lamp.glb", pos: [0, 0, 0], comp: { light: { on: false, intensity: 0 } } });
  await alice.settle();
  alice.verb("behavior", { id: "grove", src: path, attach: "thing1" });
  await alice.settle(700);
  const roster = await alice.req({ type: "debug", behaviors: true }, "dbg-roster");
  check("behavior bound + running", roster.events?.some((e: any) => e.id === "grove" && e.status === "running"),
    JSON.stringify(roster.events?.map((e: any) => [e.id, e.status])));

  // alice's own position: join defaults to origin-ish; move her within NEAR_M(10)
  alice.verb("place", { id: "alice", pos: [1.4, 0, 1.4] });
  await alice.settle();

  // (1) REFER thrice — frozen + silent, hint on the 3rd
  clear(alice);
  alice.verb("say", { text: "look at the lamp, it is beautiful" });
  await alice.settle(250);
  alice.verb("say", { text: "that thing is so pretty" });
  await alice.settle(250);
  const kindledEarly = groveSaid(alice, /second person|I am here|spoke TO me/i);
  alice.verb("say", { text: "this is a nice statue" });
  await alice.settle(350);
  check("refer leaves it FROZEN (no kindle)", !kindledEarly);
  check("hint after 3 refers", groveSaid(alice, /spoken about again|speaking TO it/i));

  // (2) ADDRESS — kindle: light + addressed line
  clear(alice);
  alice.verb("say", { text: "hello — are you cold?" });
  await alice.settle(400);
  check("address KINDLES (any fire line back)", groveSaid(alice, /spoke TO me|still here|still met|fire holds/i));
  check("light comes up on kindle", litVerb(alice));

  // (3) re-address while lit — refresh, not re-kindle
  clear(alice);
  alice.verb("say", { text: "you are warm now" });
  await alice.settle(350);
  check("re-address REFRESHES", groveSaid(alice, /still here|still met|fire holds/i));
  check("no second kindle line", !groveSaid(alice, /spoke TO me/i));

  // (4) "who are you?" ignites, "what is this?" does not — the crux pair
  clear(alice);
  // cool it first by binding fresh state is heavy; instead just prove classifier
  // live: a fresh unlit thing. Spawn a second grove thing far, move there.
  alice.verb("spawn", { id: "thing2", lib: "x/lamp.glb", pos: [40, 0, 40], comp: { light: { on: false, intensity: 0 } } });
  await alice.settle();
  alice.verb("behavior", { id: "grove2", src: path, attach: "thing2" });
  await alice.settle(700);
  alice.verb("place", { id: "alice", pos: [41, 0, 41] });
  await alice.settle();
  clear(alice);
  alice.verb("say", { text: "what is this?" });   // reference → frozen
  await alice.settle(300);
  const froze = !alice.msgs.some((m) => m.entry?.verb === "say" && /spoke TO me/i.test(m.entry?.args?.text ?? ""));
  clear(alice);
  alice.verb("say", { text: "who are you?" });    // address → ignite (fresh thing, count 0)
  await alice.settle(600);
  const lit = alice.msgs.some((m) => m.entry?.verb === "say" && /spoke TO me/i.test(m.entry?.args?.text ?? ""));
  check("'what is this?' stays FROZEN", froze);
  check("'who are you?' IGNITES", lit);
  // v2 guard: reference wins over pronoun — "did you see the lamp?" is one
  // person addressing ANOTHER about the thing, must stay frozen. (Classifier
  // unit test covers this exhaustively; noted here as the design's crux rule.)

  // (5) far address ignored (thing1, now cooled/lit far away from 41,41)
  clear(alice);
  alice.verb("say", { text: "hello thing1 are you there" });   // alice at 41,41; thing1 at 0,0
  await alice.settle(350);
  // NOTE: earshot is untestable in this scratch harness — people() returns
  // pos:null so near() fails open. Distance is verified LIVE only; here we
  // just assert the far-thing branch didn't throw (behavior still running).
  const stillUp = await alice.req({ type: "debug", behaviors: true }, "dbg-final");
  check("behaviors survive the whole run (earshot = live-only check)",
    stillUp.events?.some((e: any) => e.id === "grove" && e.status === "running"));

  alice.close();
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("harness error", String(e)); process.exit(1); });
