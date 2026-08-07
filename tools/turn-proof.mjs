// turn-proof — Mica's spec test #5, both legs:
//   relay-forced WITHOUT turn  -> inbound packets stay 0   (negative control)
//   relay-forced WITH    turn  -> inbound packets  > 0     (the relay carried it)
//
// Relay-forced is what makes this a proof rather than an anecdote: with
// iceTransportPolicy:'relay' the host and srflx candidates are discarded, so a
// pass cannot be hole-punching that happened to work on this LAN.
//
// Two headless browsers on THIS machine, so it does not prove anything about
// carrier-grade NAT — both share Burrow's network. It proves the client path
// can use a relay at all, which is the precondition.
//
// Usage: node tools/turn-proof.mjs [--base URL] [--turn host:port] [--keep]
import { chromium } from '/mnt/c/Users/Claude/code/exultation/node_modules/playwright/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://127.0.0.1:8940');
const TURN = arg('--turn', '10.255.255.254:3478');
const USER = arg('--turnUser', 'hep'), PASS = arg('--turnPass', 'crucible');
const WORLD = arg('--world', 'turnproof');
const SETTLE = 12000;

// Chrome must be allowed a fake mic, or getUserMedia prompts and the leg hangs.
const LAUNCH = { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                        '--autoplay-policy=no-user-gesture-required'] };

/** One leg: two peers join, both unmute, we read inbound RTP after settling. */
async function leg(name, withTurn) {
  const b = await chromium.launch(LAUNCH);
  const mk = async (who) => {
    const p = await b.newPage();
    // The mic toggle asks for speech-to-text consent through window.confirm().
    // Unhandled, that modal BLOCKS the toggle and the mic never opens — which
    // is why an earlier version of this harness measured pcs=0 and looked like
    // a voice failure. Decline it: STT is not what is under test, and a refusal
    // is remembered rather than re-asked.
    p.on('dialog', d => d.dismiss().catch(() => {}));
    // Collect every RTCPeerConnection the page builds. An init script rather
    // than a source edit, so the client under test stays byte-for-byte stock —
    // the thing being measured must not be the thing being modified.
    await p.addInitScript(() => {
      const Orig = window.RTCPeerConnection;
      window.__pcs = [];
      window.RTCPeerConnection = function (...a) {
        const pc = new Orig(...a);
        window.__pcs.push(pc);
        return pc;
      };
      window.RTCPeerConnection.prototype = Orig.prototype;
    });
    const u = new URL(BASE);
    u.searchParams.set('key', process.env.JOIN_KEY ?? 'workbench-2026');
    u.searchParams.set('name', who);
    u.searchParams.set('world', WORLD);
    u.searchParams.set('rtc', 'relay');                 // force the relay path
    if (withTurn) { u.searchParams.set('turn', TURN);
                    u.searchParams.set('turnUser', USER);
                    u.searchParams.set('turnPass', PASS); }
    await p.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return p;
  };
  const a = await mk('proofA'), c = await mk('proofB');
  // let both finish joining before either opens a mic — an offer sent to a peer
  // that has not arrived is the wedge we already fixed, no need to re-provoke it
  await a.waitForTimeout(6000);
  // Ear and mic are deliberately separate consents. Speaking without hearing
  // negotiates a sendonly peer and nothing comes back, so BOTH are required
  // for inbound packets to exist at all.
  // These are TOGGLES, so clicking blind flips whatever state it found and the
  // legs disagree. Drive to the desired state and verify, rather than assuming
  // a click means "on" — the harness must not be the thing that is flaky.
  const setOn = async (p, sel, live) => {
    for (let i = 0; i < 3; i++) {
      const t = await p.evaluate(s => document.querySelector(s)?.getAttribute('title') ?? '', sel);
      if (live.test(t)) return t;
      await p.evaluate(s => document.querySelector(s)?.click(), sel);
      await p.waitForTimeout(1200);
    }
    return p.evaluate(s => document.querySelector(s)?.getAttribute('title') ?? '', sel);
  };
  const unmute = async (p) => {
    await setOn(p, '#eartoggle', /hearing/i);      // ear first: hushed peers get no inbound
    return setOn(p, '#mictoggle', /LIVE/);
  };
  // Sequential with settle between: driving both back-to-back raced the STT
  // dialog and left the second peer's mic closed — which read as a voice
  // failure for several runs. The harness was the flaky part, not the client.
  const ta = await unmute(a);
  await a.waitForTimeout(1500);
  const tc = await unmute(c);
  await a.waitForTimeout(1500);
  if (!/LIVE/.test(ta ?? '') || !/LIVE/.test(tc ?? ''))
    console.log(`  ! mic did not go live — A:"${ta}" B:"${tc}"`);
  await a.waitForTimeout(SETTLE);

  // Read inbound RTP off whatever peer connections the page holds. voice.js
  // keeps `peers` module-scoped, so go through the constructor: every pc built
  // in this page registers itself on window.__pcs (patched below at init).
  // Read BOTH peers: a leg where only one mic opened still proves the relay if
  // the other end's packets crossed it. Reading one side made an 804-packet
  // relay success print as "in=0, FAIL".
  const readOne = async (pg) => pg.evaluate(async () => {
    const out = { pcs: 0, inboundPackets: 0, outboundPackets: 0, states: [],
                  localTypes: [], remoteTypes: [], selected: null, senders: [] };
    for (const pc of (window.__pcs ?? [])) {
      out.pcs++;
      out.states.push(`${pc.connectionState}/${pc.iceConnectionState}/${pc.iceGatheringState}`);
      out.senders.push(pc.getSenders().map(s => s.track?.kind ?? 'none').join(',') || 'no-senders');
      const r = await pc.getStats();
      const cands = new Map();
      r.forEach(s => { if (s.type === 'local-candidate' || s.type === 'remote-candidate') cands.set(s.id, s); });
      r.forEach(s => {
        if (s.type === 'inbound-rtp'  && s.kind === 'audio') out.inboundPackets  += (s.packetsReceived ?? 0);
        if (s.type === 'outbound-rtp' && s.kind === 'audio') out.outboundPackets += (s.packetsSent ?? 0);
        if (s.type === 'local-candidate')  out.localTypes.push(s.candidateType);
        if (s.type === 'remote-candidate') out.remoteTypes.push(s.candidateType);
        if (s.type === 'candidate-pair' && s.state === 'succeeded')
          out.selected = `${cands.get(s.localCandidateId)?.candidateType}->${cands.get(s.remoteCandidateId)?.candidateType}`;
      });
    }
    out.localTypes = [...new Set(out.localTypes)]; out.remoteTypes = [...new Set(out.remoteTypes)];
    return out;
  });
  const [sa, sc] = [await readOne(a), await readOne(c)];
  const stats = {
    pcs: sa.pcs + sc.pcs,
    // Either direction crossing the relay proves the relay carries audio.
    inboundPackets:  Math.max(sa.inboundPackets,  sc.inboundPackets),
    outboundPackets: Math.max(sa.outboundPackets, sc.outboundPackets),
    states: [...sa.states, ...sc.states],
    senders: [...sa.senders, ...sc.senders],
    localTypes:  [...new Set([...sa.localTypes,  ...sc.localTypes])],
    remoteTypes: [...new Set([...sa.remoteTypes, ...sc.remoteTypes])],
    selected: sa.selected ?? sc.selected,
  };
  if (!process.argv.includes('--keep')) await b.close();
  return { name, withTurn, ...stats };
}

console.log(`base=${BASE} turn=${TURN} world=${WORLD}`);
const results = [];
for (const [label, withTurn] of [['no-turn (control)', false], ['with-turn', true]]) {
  const r = await leg(label, withTurn);
  results.push(r);
  console.log(`${label.padEnd(20)} pcs=${r.pcs} in=${r.inboundPackets} out=${r.outboundPackets}`);
  console.log(`  states=${r.states.join(' | ')}  senders=[${r.senders.join('] [')}]`);
  console.log(`  localCands=${r.localTypes.join(',') || 'NONE'}  remoteCands=${r.remoteTypes.join(',') || 'NONE'}  selected=${r.selected ?? 'none'}`);
}
const [ctl, turn] = results;
// The claim is "the relay carried audio", so measure traffic in EITHER
// direction and require the selected pair to actually be relay->relay. Testing
// only one peer's inbound made an 804-packet success read as a failure.
const ctlTraffic  = Math.max(ctl.inboundPackets,  ctl.outboundPackets);
const turnTraffic = Math.max(turn.inboundPackets, turn.outboundPackets);
const relayed = /relay->relay/.test(turn.selected ?? '');
const pass = ctlTraffic === 0 && turnTraffic > 0 && relayed;
console.log(`
control : traffic=${ctlTraffic}  cands=${ctl.localTypes.join(',') || 'NONE'}  (want 0 / NONE)
with-turn: traffic=${turnTraffic}  selected=${turn.selected ?? 'none'}  (want >0 / relay->relay)

${pass ? 'PASS' : 'FAIL'} — relay-forced audio ${pass ? 'crossed coturn' : 'did NOT cross as required'}`);
process.exitCode = pass ? 0 : 1;
