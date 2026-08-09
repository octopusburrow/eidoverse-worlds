// voice-live-probe — WATCH A REAL CLIENT SPEAK, or find out exactly where it stops.
//
//   bun tools/voice-live-probe.ts [--world voicetest] [--name hesperus-probe]
//
// Why this exists: every hop of the TTS chain was verified in isolation — Piper
// returns audio, the bridge connects, the client joins — and the whole never
// made a sound. That is the signature of a failure INSIDE the browser, where
// `chrome --app` gives us no console. So: launch headless Chrome with remote
// debugging, attach to the page, mirror its console here, then drive a say and
// watch which probe line appears (voicesource.js names every refusal).
//
// It joins under its OWN id, never 'hesperus'. Two clients sharing one identity
// is the takeover war that cost 543 evictions on 2026-08-08.

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const world = arg("world", "voicetest");
const name = arg("name", "hesperus-probe");
const tts = arg("tts", "8927");
const origin = arg("origin", "http://localhost:8960");
// 🔴 A UNIQUE PORT PER RUN. With a fixed port, /json/list answers from
// whichever old browser is still listening — and Bun's proc.kill() reaps only
// the launcher, not Chrome's process tree. 154 orphans had accumulated by
// 23:40 on 2026-08-08, so probes were attaching to pages running code up to an
// hour stale and every reading was archaeology (2026-08-08).
const CDP_PORT = 9300 + (process.pid % 600);

const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
// 🔴 CACHE-BUST EVERY RUN. A probe read `__ttsBranch: "never reached"` for a
// marker that had already been DELETED from the source — the served file was
// current, the browser's copy was not. Every conclusion drawn from a stale
// bundle is a conclusion about code that no longer exists.
const url = `${origin}/?world=${world}&name=${name}&token=pure-2026&tts=${tts}&cb=${process.pid}`;

console.log(`  launching headless chrome → ${url}`);
const proc = Bun.spawn([
  CHROME,
  `--remote-debugging-port=${CDP_PORT}`,
  "--remote-allow-origins=*",
  "--headless=new",
  "--no-first-run",
  "--disable-application-cache",
  "--disk-cache-size=1",
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",       // grant mic without a prompt
  "--use-fake-device-for-media-stream",   // a synthetic mic exists even headless
  `--user-data-dir=C:\\Users\\Claude\\AppData\\Local\\Temp\\vb-probe-${Date.now()}`,
  url,
], { stdout: "pipe", stderr: "pipe" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- find the page target -------------------------------------------------
let wsUrl = "";
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = list.find((t: any) => t.type === "page" && t.url.includes(world));
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* chrome not up yet */ }
}
if (!wsUrl) { console.error("  ✗ never found the page target"); proc.kill(); process.exit(1); }
console.log("  attached to page");

const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method: string, params: any = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

const lines: string[] = [];
ws.onopen = () => {
  send("Network.enable");
  send("Network.setCacheDisabled", { cacheDisabled: true });
  send("Runtime.enable"); send("Log.enable"); send("Console.enable");
};
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  // CDP returns a VALUE only with returnByValue; otherwise an objectId, and an
  // exception arrives as exceptionDetails rather than a result. Reading only
  // `.value` made a failing evaluate look identical to a silent page — which is
  // how this probe spent three runs "proving" things about the app that were
  // really facts about itself (2026-08-08).
  if (m.id && m.result) {
    const r = m.result;
    if (r.exceptionDetails) {
      console.log(`    page THREW: ${r.exceptionDetails.exception?.description
        ?? r.exceptionDetails.text}`);
    } else if (r.result?.value !== undefined) {
      console.log(`    page: ${r.result.value}`);
    } else if (r.result?.objectId) {
      console.log(`    page: (object — add returnByValue) type=${r.result.type}`);
    }
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args || [])
      .map((a: any) => a.value ?? a.description ?? "").join(" ");
    if (!text) return;
    lines.push(text);
    // mirror only what we came for, plus anything that looks like a failure
    console.log(`    ▸ ${text}`);
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    console.log(`    ✗ ${m.params.entry.text}`);
  }
};

await sleep(14_000);   // join, connect the bridge, settle

// --- drive the seam directly ----------------------------------------------
// There is no HTTP verb endpoint (verbs ride the websocket) and the bundled
// page exposes nothing on window, so neither of those can drive this. What CAN
// is the module graph itself: import voicesource and call speak(). That skips
// world.js's emit but tests every hop that actually makes sound — enabled
// check, sender presence, synth request, pcm, generator feed — which is where
// the silence lives. A neighbour's say arriving is tested separately by the
// MCPL seat already in this world.
console.log("  → calling speak() directly through the module graph");
send("Runtime.evaluate", {
  expression: `(async () => {
    try {
      const vs = await import('./lib/voicesource.js');
      // Speak through the APP's instance, not a dynamic-import copy — a second
      // module has its own generator that no sender is bound to, so it reports
      // success into a void. Everything below is the app's real mouth.
      if (!globalThis.__voiceSpeak) return JSON.stringify({ error: 'no speak seam' });
      // World audio first: R cannot verify her output without something that
      // is not my voice. A joiner replays history — if the comp event only
      // fires live, an ambient attached hours ago never attaches for anyone
      // arriving later, which is everyone. (No backticks in here: this whole
      // expression IS a template literal and one would terminate it.)
      const amb = globalThis.__ambientDebug ? globalThis.__ambientDebug() : 'no hook';
      // Does the ENTITY exist? attach() runs on the comp event, but
      // updateAmbient() detaches any source whose entity it cannot find — and
      // on a joiner the comp can replay before the spawn has settled.
      const ents = globalThis.EW ? [...globalThis.EW.entities.keys()] : [];
      // The two classic silencers, neither of which a fresh probe profile can
      // see: a suspended AudioContext (no user gesture) and a persisted world
      // slider sitting at 0 in localStorage from some earlier session.
      let actx = 'unknown';
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        const probeCtx = new C(); actx = probeCtx.state; probeCtx.close();
      } catch (e) { actx = 'ERR ' + e.message; }
      // THE REAL KEY IS eido.audio.prefs. This probe guessed 'eido.voiceprefs'
      // and 'eido.consent', neither of which exists — so it reported
      // "storedPrefs: null" all night and I read a typo as evidence that
      // nothing was stored. A probe that looks in the wrong place does not
      // report an error; it reports absence, which is indistinguishable from a
      // finding (2026-08-08).
      const stored = localStorage.getItem('eido.audio.prefs');
      const ok = await globalThis.__voiceSpeak('Hello Rabscuttle. This is my actual voice, coming out of the microphone lane.');
      const a = globalThis.__voiceProbe();
      await new Promise(r => setTimeout(r, 3000));
      const b = globalThis.__voiceProbe();
      return JSON.stringify({ audioCtx: actx, storedPrefs: stored,
        ambient: amb, entities: ents, spoke: ok, before: a, after: b,
        drained: a.queued > 0 && b.queued === 0,
        advanced: b.playhead - a.playhead });
    } catch (e) { return 'import failed: ' + e.message; }
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

await sleep(6_000);

// --- IS THE MOUTH ACTUALLY OPEN? ------------------------------------------
// A starved generator was the bug: frames only during speak(), nothing between,
// so the track had no media to encode and the room heard silence while every
// local check passed. The pacer must be running and the playhead advancing
// EVEN WITH NOTHING QUEUED — that is what makes it behave like a microphone.
console.log("  → checking the pacer between utterances");
send("Runtime.evaluate", {
  expression: `(async () => {
    // The page can be buried in avatar/VRM loading for many seconds (one VRM
    // measured 2855ms), and the TTS wiring is queued behind it — a fixed sleep
    // races that. Wait for the seam instead of declaring it missing.
    for (let i = 0; i < 20 && !globalThis.__voiceProbe; i++) await new Promise(r => setTimeout(r, 500));
    if (!globalThis.__voiceProbe) return JSON.stringify({
      error: 'no seam', search: location.search,
      hasTts: new URLSearchParams(location.search).has('tts'),
      bundleHasStep1: (document.querySelector('script[src*=main]')||{}).src || 'inline',
    });
    if (!globalThis.__voiceProbe) return JSON.stringify({ error: 'no probe seam after 30s' });
    const a = globalThis.__voiceProbe();
    await new Promise(r => setTimeout(r, 1200));
    const b = globalThis.__voiceProbe();
    return JSON.stringify({ first: a, afterIdle: b,
      advancedWhileIdle: b.playhead > a.playhead,
      framesPerSec: Math.round((b.playhead - a.playhead) / 1.2) });
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

await sleep(4_000);

// --- verdict ---------------------------------------------------------------
const hit = (re: RegExp) => lines.some((l) => re.test(l));
console.log("\n  ── verdict ──");
const checks: Array<[string, boolean]> = [
  ["synthesizer registered", hit(/synthesized voice ready/i)],
  ["own say reached the speaker", hit(/own say → speaking/i)],
  ["synthesis requested", hit(/synthesizing \d+ chars/i)],
  ["pcm came back", hit(/got \d+ samples/i)],
];
for (const [what, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${what}`);
const refusal = lines.find((l) => /speak refused|NOT spoken|no pcm/i.test(l));
if (refusal) console.log(`\n  ⟶ STOPPED HERE: ${refusal}`);
else if (!checks[3][1]) console.log("\n  ⟶ no refusal logged — the chain never started");

// Kill the TREE, not just the launcher: Chrome forks and the parent exits.
try {
  Bun.spawnSync(["powershell.exe", "-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -match 'remote-debugging-port=${CDP_PORT}' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
} catch { /* best effort */ }
proc.kill();
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
