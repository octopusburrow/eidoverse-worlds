// scrollbar + tint verification on REAL Windows Chrome via CDP (vr-lab pattern)
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const KEY = process.env.JOIN_KEY;
const kill = () => { try { execSync(`powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { \$_.CommandLine -like '*sb-lab-profile*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"`, { timeout: 15000 }); } catch {} };
kill();
execSync(`"${CHROME}" --remote-debugging-port=9224 --user-data-dir=C:\\\\temp\\\\sb-lab-profile --no-first-run --window-size=1300,850 about:blank &`, { shell: '/bin/bash' });
await new Promise(r => setTimeout(r, 6000));
let ws = '';
for (let i = 0; i < 5 && !ws; i++) {
  try { ws = execSync("curl -s -m 3 http://127.0.0.1:9224/json/version | grep -o '\"webSocketDebuggerUrl\": *\"[^\"]*\"' | cut -d'\"' -f4").toString().trim(); } catch {}
  if (!ws) await new Promise(r => setTimeout(r, 2000));
}
if (!ws) { console.log('no CDP'); kill(); process.exit(1); }
const browser = await chromium.connectOverCDP(ws, { timeout: 8000 });
const ctx = browser.contexts()[0];
const pg = ctx.pages()[0] ?? await ctx.newPage();
// Windows reaches WSL via localhost forwarding (WSL2 localhostForwarding)
await pg.goto(`http://localhost:8960/?world=staging&name=uiprobe&key=${KEY}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await pg.waitForSelector('#splash.gone', { timeout: 120000 });
await new Promise(r => setTimeout(r, 6000));
console.log(await pg.evaluate(() => {
  const s = [...document.querySelectorAll('.frame .stack')].find(s => s.scrollHeight > s.clientHeight);
  return s ? `gutter: ${s.offsetWidth - s.clientWidth}px (sh ${s.scrollHeight} ch ${s.clientHeight})` : 'no overflowing stack';
}));
await pg.screenshot({ path: '/tmp/win-1-panes.png', timeout: 30000 });
// tint check on real GPU: rank mode, time it
const t0 = Date.now();
await pg.evaluate(async () => (await import('./lib/perfscope.js')).setMode('rank'));
await new Promise(r => setTimeout(r, 2500));
await pg.screenshot({ path: '/tmp/win-2-rank.png', timeout: 30000 });
console.log('tint applied+settled in', Date.now() - t0, 'ms wall');
await pg.evaluate(async () => (await import('./lib/perfscope.js')).perfscopeOff());
await browser.close(); kill();
console.log('done');
