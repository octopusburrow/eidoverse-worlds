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
const CDP_PORT = 9333;

const CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const url = `${origin}/?world=${world}&name=${name}&token=pure-2026&tts=${tts}`;

console.log(`  launching headless chrome → ${url}`);
const proc = Bun.spawn([
  CHROME,
  `--remote-debugging-port=${CDP_PORT}`,
  "--remote-allow-origins=*",
  "--headless=new",
  "--no-first-run",
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
ws.onopen = () => { send("Runtime.enable"); send("Log.enable"); send("Console.enable"); };
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && m.result?.result?.value) {
    console.log(`    page: ${m.result.result.value}`);
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const text = (m.params.args || [])
      .map((a: any) => a.value ?? a.description ?? "").join(" ");
    if (!text) return;
    lines.push(text);
    // mirror only what we came for, plus anything that looks like a failure
    if (/\[voice\]|voicesource|synth|mic|sender|tts/i.test(text)) console.log(`    ▸ ${text}`);
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
      const ok = await vs.speak('Probe check. Can you hear this?');
      return 'speak() returned ' + ok;
    } catch (e) { return 'import failed: ' + e.message; }
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

await sleep(6_000);

// --- DRIVE THE REAL AUDIO PANEL -------------------------------------------
// Dynamic import() of an app module fetches the SOURCE and builds a SECOND
// module instance with its own state — so probing that way reads a copy the app
// never used (it reported genTrack:null and no peers while the app was fine).
// The DOM is shared, so drive the actual panel the way R does instead.
console.log("  → driving the real audio panel");
send("Runtime.evaluate", {
  expression: `(() => {
    // Rows are built lazily by makeSection's onOpen, so a closed panel has
    // none — the probe's first run reported rows:0 and that meant "not opened",
    // not "not built". Click the header the way a person does.
    document.querySelector('#sec-audio .head, #sec-audio > *')?.click?.();
    const rows = [...document.querySelectorAll('.sp-row')];
    const row = rows.find(r => /TTS/i.test(r.textContent || ''));
    if (!row) return JSON.stringify({ found: false, rows: rows.length,
      hosts: [...document.querySelectorAll('[id],[class]')]
        .filter(e => /audio|sound|panel/i.test(e.id + ' ' + e.className)).map(e => e.id || e.className).slice(0, 8) });
    const box = row.querySelector('input[type=checkbox]');
    const txt = row.querySelector('input[type=text]');
    const note = row.querySelector('.sp-note');
    return JSON.stringify({
      found: true,
      label: (row.querySelector('.sp-label')||{}).textContent,
      boxDisabled: box?.disabled, boxChecked: box?.checked,
      placeholder: txt?.placeholder ?? '(no text field — harness voice)',
      value: txt?.value ?? '', note: note?.textContent ?? '',
    });
  })()`,
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

proc.kill();
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
