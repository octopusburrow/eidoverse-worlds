// vr-lab — emulated Quest 3 (iwer) inside WINDOWS Chrome over CDP, so the
// real Radeon renders what the headset would see. Born 2026-08-05 after an
// evening of patching XR bugs blind: headless SwiftShader never reproduced
// the renderList crash or any of R's five in-headset symptoms, so this is
// the loop. Sweeps head yaw/pitch, captures a frame per pose, probes the
// ground band, and reports renderList holes + uncaught errors.
//
// Usage:  node tools/vr-lab.mjs [--keep]   (server must be up on :8940)
// Chrome: launched fresh on port 9223 with its own temp profile; killed at
// the end unless --keep. Frames land in /tmp/vr-lab/.
import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const KEEP = process.argv.includes('--keep');
const OUT = '/tmp/vr-lab';
fs.mkdirSync(OUT, { recursive: true });
const iwerSrc = fs.readFileSync(new URL('./iwer.js', import.meta.url), 'utf8');

// ---- Windows Chrome with real GPU ------------------------------------------
const CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = 'C:\\Users\\Claude\\AppData\\Local\\Temp\\vr-lab-profile';
const killChrome = () => { try { execSync(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { \$_.CommandLine -like '*vr-lab-profile*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"`, { timeout: 15000 }); } catch {} };
killChrome();
spawn(CHROME, [
  '--remote-debugging-port=9223', `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--window-size=1500,900', '--autoplay-policy=no-user-gesture-required',
], { detached: true, stdio: 'ignore' }).unref();
// playwright's own /json/version fetch stalls across the WSL boundary; curl
// doesn't — so fetch the ws endpoint with curl and hand playwright the URL.
let browser = null, lastErr = null;
for (let i = 0; i < 30 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 500));
  let ws = '';
  try { ws = execSync("curl -s -m 3 http://127.0.0.1:9223/json/version | grep -o '\"webSocketDebuggerUrl\": *\"[^\"]*\"' | cut -d'\"' -f4").toString().trim(); } catch {}
  if (!ws) continue;
  browser = await chromium.connectOverCDP(ws, { timeout: 6000 }).catch((e) => { lastErr = e; return null; });
}
console.error('cdp connected:', !!browser); if (!browser) { console.error('no CDP:', lastErr?.message?.slice(0, 200)); process.exit(1); }

const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.newPage();
for (const p of ctx.pages().slice(1)) await p.close().catch(() => {});
console.error('page ready');
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.addInitScript(`${iwerSrc}
  const dev = new IWER.XRDevice(IWER.metaQuest3);
  dev.installRuntime({ forceInstall: true });
  window.__xrdev = dev;`);
console.error("goto..."); await page.goto('http://localhost:8940/?key=workbench-2026&name=vrlab&world=workbench&xr=1', { waitUntil: 'domcontentloaded' });

const cdp = await ctx.newCDPSession(page);
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(data, 'base64'));
};

const r = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const net = await import('/lib/net.js');
  const xr = await import('/lib/xr.js');
  const { myState } = await import('/lib/controller.js');
  const out = { logs: [] };
  for (let i = 0; i < 60 && !net.net?.joined; i++) await sleep(250);
  out.joined = !!net.net?.joined;
  document.querySelector('.xr-chip')?.click();
  for (let i = 0; i < 40 && !xr.xrDebug().presenting; i++) await sleep(300);
  out.presenting = xr.xrDebug().presenting;
  if (!out.presenting) return out;
  myState.pos.set(30, 1.5, 20);
  await sleep(1500);
  // first-person verification: split ran, label hidden, eye cams masked
  try {
    const main = await import('/main.js');
    const { renderer } = await import('/lib/core.js');
    const me = globalThis.__me?.() ?? null;
    out.fp = { hasFP: !!me?.vrm?.firstPerson, labelHidden: me?.label ? !me.label.visible : null };
    const xc = renderer.xr.getCamera?.();
    out.fp.eyeFP = xc?.cameras?.map((c) => [c.layers.isEnabled?.(9) ?? ((c.layers.mask >> 9) & 1), (c.layers.mask >> 10) & 1]);
  } catch (e) { out.fpErr = String(e).slice(0, 120); }
  return out;
});
console.log('enter:', JSON.stringify(r));
console.log('pageErrors:', JSON.stringify(errors.slice(0, 6)));
if (!r.presenting) { console.error(errors.slice(0, 4)); process.exit(1); }

// ---- head sweep: 12 yaws x 2 pitches, frame + probes per pose ---------------
const poses = [];
for (let p = 0; p < 2; p++) for (let y = 0; y < 8; y++)
  poses.push({ yaw: (y * Math.PI) / 4, pitch: p ? -0.35 : 0 });

const report = [];
for (let i = 0; i < poses.length; i++) {
  const { yaw, pitch } = poses[i];
  console.error(`pose ${i}...`);
  const probe = await page.evaluate(async ({ yaw, pitch }) => {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const dev = window.__xrdev;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    dev.quaternion.set(sp * cy, cp * sy, -sp * sy, cp * cy); // pitch then yaw
    await sleep(450);
    const { scene, camera } = await import('/lib/core.js');
    const { ground } = await import('/lib/core.js');
    // truth from the graph, not pixels: is the ground in the draw this frame?
    let groundDrawn = null, bodyVisible = null, labelPos = null;
    scene.traverse((o) => {
      if (o === ground) groundDrawn = o.visible;
      if (o.name === 'my-avatar' || o.userData?.mine) bodyVisible = o.visible;
      if (o.userData?.nameplateFor === 'vrlab' || (o.name || '').includes('label')) {
        labelPos = o.getWorldPosition(new (o.position.constructor)()).toArray().map((n) => +n.toFixed(1));
      }
    });
    const errs = (globalThis.__errLog || []).length;
    const holes = (globalThis.__errLog || []).filter((e) => /hole/.test(e)).length;
    return { groundDrawn, bodyVisible, labelPos, errs, holes,
      sun: (await import('/lib/core.js')).sun.position.toArray().map((n) => +n.toFixed(1)) };
  }, { yaw, pitch });
  if (process.argv.includes('--shots')) await shot(`pose-${String(i).padStart(2, '0')}`);
  console.log('POSE ' + JSON.stringify({ i, yawDeg: (yaw*57.3)|0, pitchDeg: (pitch*57.3)|0, ...probe }));
  report.push({ i, yawDeg: (yaw * 57.3) | 0, pitchDeg: (pitch * 57.3) | 0, ...probe });
}

console.log('pageerrors:', errors.length, errors.slice(0, 5));
console.log('renderList crash reproduced:', errors.some((e) => e.includes('renderList')) ? 'YES' : 'no');
if (!KEEP) killChrome();
