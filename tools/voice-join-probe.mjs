// voice-join-probe — join a LIVE world as a real browser peer, mic on, and
// report what actually arrives. Not a test: an instrument, for when humans in
// the room disagree about who can hear whom.
//
// Deliberately joins AFTER the humans are already there and only then opens
// the mic — that ordering is the bug PR #62 repairs, and the one a
// mic-up-before-joining test cannot see.
//
//   bun tools/voice-join-probe.mjs "<base-url>" <name> <world> [seconds]
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:8960';
const NAME = process.argv[3] ?? 'probe';
const WORLD = process.argv[4] ?? 'voicetest';
const SECS = Number(process.argv[5] ?? 45);

// The npx-cached playwright wants a browser build that isn't here (1223); the
// cache has 1228. Point at the binary that exists rather than downloading a
// second copy of Chromium onto a laptop.
const EXE = process.env.PW_CHROME
  ?? '/home/claude/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browser = await chromium.launch({
  executablePath: EXE,
  args: [
    '--use-fake-ui-for-media-stream',      // auto-grant mic
    '--use-fake-device-for-media-stream',  // synthetic tone, no hardware needed
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();

page.on('console', (m) => {
  const t = m.text();
  if (/voice|rtc|ice|mic|peer/i.test(t)) console.log('  [page]', t.slice(0, 160));
});

const url = `${BASE}/?world=${WORLD}&name=${NAME}`;
console.log(`joining ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });

// let the world hydrate and peers appear BEFORE the mic opens
await page.waitForTimeout(12000);

const before = await page.evaluate(() => ({
  peers: Object.keys(globalThis.voiceDebug?.() ?? {}),
}));
console.log('  peers before mic:', JSON.stringify(before.peers));

// consent to receive, then open the mic — in that order, second
await page.evaluate(async () => {
  const c = await import('/lib/voiceconsent.js');
  c.setReceiveVoice(true);
});
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  const v = await import('/lib/voice.js');
  if (!v.micOn()) await v.toggleMic(location.search.match(/name=([^&]+)/)?.[1] ?? 'probe');
});
console.log('  mic opened AFTER joining (the failing order)');

const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  await page.waitForTimeout(8000);
  const s = await page.evaluate(async () => {
    const v = await import('/lib/voice.js');
    const out = { stats: await v.voiceStats?.(), mouth: v.voiceMouthBound?.() };
    // candidate-pair detail for any peer that has not reached 'connected' —
    // "connecting" forever is an ICE failure, a different animal from
    // "connected but silent", and only the pairs say which.
    out.ice = {};
    for (const pc of (v.voicePcs?.() ?? [])) {
      const st = await pc.getStats(); const c = new Map(); let sel = null, cands = [];
      st.forEach((r) => { if (r.type.endsWith('-candidate')) { c.set(r.id, r); cands.push(`${r.candidateType}/${r.protocol ?? '?'}`); } });
      st.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded') sel = `${c.get(r.localCandidateId)?.candidateType}->${c.get(r.remoteCandidateId)?.candidateType}`; });
      out.ice[pc.__id ?? 'pc'] = { conn: pc.connectionState, ice: pc.iceConnectionState, sel, cands: [...new Set(cands)] };
    }
    // OUTBOUND too: 'connected with 0 inbound' is ambiguous — it means either
    // they are not sending, or we are not receiving. The out-counters and the
    // transceiver directions disambiguate, and that distinction is the whole
    // difference between a sender bug and a receiver bug.
    out.tx = {};
    for (const pc of (v.voicePcs?.() ?? [])) {
      const st = await pc.getStats(); let outp = 0;
      st.forEach((r) => { if (r.type === 'outbound-rtp' && r.kind === 'audio') outp += r.packetsSent ?? 0; });
      const dirs = pc.getTransceivers().map((t) => `${t.currentDirection ?? t.direction}`).join(',');
      const senders = pc.getSenders().map((sn) => sn.track ? `${sn.track.kind}:${sn.track.readyState}` : 'NO-TRACK').join(',');
      out.tx[dirs] = { outPkts: outp, senders };
    }
    return out;
  });
  console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s`, JSON.stringify(s.stats), 'mouth:', JSON.stringify(s.mouth));
}

await browser.close();
