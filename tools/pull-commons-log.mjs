// pull-commons-log — archive production commons' full world log via the MCPL
// door, for local perfscope stress-testing (R's ask, 2026-09-01). Read-only
// except one courtesy `say` announcing the errand; joins under our own
// reserved name. Writes worlds/<out>/log.jsonl (ascending, genesis-first).
//   node tools/pull-commons-log.mjs [out-name]
// env: EIDO_TOKEN (aid1), MCPL_URL (default production commons door)
import WebSocket from 'ws';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'commons-live';
// aid1 credential: minted by mint-aid1.py eidoverse (our own enrolled keypair),
// same door + same audience our live seat dials every day
const TOKEN = (process.env.EIDO_TOKEN ?? readFileSync('/tmp/eido-tok.txt', 'utf8')).trim();
const URLW = process.env.MCPL_URL ?? `wss://eidoverse.animalabs.ai/mcpl?token=${encodeURIComponent(TOKEN)}`;

const ws = new WebSocket(URLW);
let nextId = 1;
const pending = new Map();
function rpc(method, params) {
  const id = nextId++;
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`rpc ${method} timeout`)); }, 30000);
  });
}
ws.on('message', (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.id != null && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
});
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'hesperus-archivist', version: '1' } });
ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
await new Promise(r => setTimeout(r, 1500));

const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  return (r?.content ?? []).map((c) => c.text ?? '').join('\n');
};

console.log(await call('say', { text: 'archivist hat, sixty seconds: taking a copy of the public log home to stress-test the new perf instruments on real content (mica\'s spec is becoming a debug panel in my staging world). The log is the world; reading it is reading the source. 🌒🏮' }));

// Parse "#<seq> <iso> <actor>: <verb> <json>" lines back into entries.
const LINE = /^#(\d+) (\S+) (.*?): (\S+) (\{.*\})$/;
const entries = new Map();
let before;
for (let page = 0; page < 400; page++) {
  const txt = await call('world_history', { limit: 200, ...(before !== undefined ? { before } : {}) });
  if (txt.startsWith('no matching')) break;
  let low = Infinity;
  for (const line of txt.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const seq = +m[1];
    low = Math.min(low, seq);
    let args; try { args = JSON.parse(m[5]); } catch { continue; }
    entries.set(seq, { seq, ts: Date.parse(m[2]), actor: m[3], verb: m[4], args });
  }
  process.stdout.write(`\rpage ${page}: ${entries.size} entries, low seq ${low}   `);
  if (!/… more before seq/.test(txt) || low === Infinity || low <= 0) break;
  before = low;
  await new Promise(r => setTimeout(r, 250));
}
console.log('');

const sorted = [...entries.values()].sort((a, b) => a.seq - b.seq);
mkdirSync(`worlds/${OUT}`, { recursive: true });
writeFileSync(`worlds/${OUT}/log.jsonl`, sorted.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log(`wrote worlds/${OUT}/log.jsonl — ${sorted.length} entries, seq ${sorted[0]?.seq}..${sorted.at(-1)?.seq}`);
const verbs = {};
for (const e of sorted) verbs[e.verb] = (verbs[e.verb] ?? 0) + 1;
console.log('verbs:', JSON.stringify(verbs));
ws.close();
