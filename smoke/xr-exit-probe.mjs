// Emulated headset (IWER fake Quest 3, WebGL path) drives enter → present → leave without a real HMD,
// then reads what the desktop canvas actually is afterwards (R 09-06 23:43: 'desktop window still black
// when leaving VR'). Usage: node smoke/xr-exit-probe.mjs <url> [iwer.js path]
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'fs';
const url = process.argv[2]; const iwer = readFileSync(process.argv[3] ?? '/tmp/claude-1000/iwer/node_modules/iwer/build/iwer.js', 'utf8');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(iwer + `
  try { localStorage.setItem('ew-name-set', '1'); } catch {}
  const dev = new IWER.XRDevice(IWER.metaQuest3); dev.installRuntime({ forceInstall: true }); globalThis.__iwer = dev;
  globalThis.__tee = []; const oc = console.log.bind(console); console.log = (...a) => { const s = a.join(' '); if (/\\[xr\\]|\\[boot\\]|\\[thumb\\]/.test(s)) globalThis.__tee.push(s.slice(0, 300)); oc(...a); };
`);
const p = await ctx.newPage(); const errs = []; let phase = 'boot';
p.on('pageerror', (e) => errs.push(phase + ' PAGEERROR ' + String(e).slice(0, 160)));
p.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errs.push(phase + ' ' + m.text().split('\n')[0].slice(0, 160)); });
await p.goto(url);
await p.waitForFunction(() => getComputedStyle(document.getElementById('splash')).display === 'none', { timeout: 180000 });
await p.waitForTimeout(2500);
const mean = async (tag) => { if (process.env.SHOT) { try { const png = await p.screenshot({ timeout: 8000 }); writeFileSync(`/tmp/claude-1000/xrexit-${tag}.png`, png); } catch (e) { console.log(`shot ${tag}: ${e.message.split("\n")[0]}`); } } return p.evaluate(async () => { const { renderer, scene, camera } = await import('/lib/core.js'); let renderErr = null; try { if (!renderer.xr.isPresenting) renderer.render(scene, camera); } catch (e) { renderErr = String(e).slice(0, 120); } const cv = document.querySelector('canvas'); const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); try { if (renderErr) return 'renderThrew:' + renderErr; g.drawImage(cv, cv.width * .4, cv.height * .4, cv.width * .2, cv.height * .2, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let a = 0; for (let i = 0; i < d.length; i += 4) a += d[i] + d[i + 1] + d[i + 2]; return +(a / 64 / 3).toFixed(1); } catch (e) { return 'err:' + e.name; } }); };
const before = await mean('before'); phase = 'enter';
const entered = await p.evaluate(async () => { const m = await import('/lib/mictoggle.js'); m.flipXr(); await new Promise((r) => setTimeout(r, 6000)); const x = await import('/lib/xr.js'); return { presenting: !!x.isPresenting?.() }; });
const during = await p.evaluate(() => globalThis.__tee.filter((l) => /curtain|entry:|session on|head chop/.test(l)).slice(-4));
phase = 'present'; await p.waitForTimeout(1500); phase = 'exit'; await p.evaluate(async () => { const x = await import('/lib/xr.js'); x.leaveVR('probe'); });
await p.waitForTimeout(4500);
const after = await mean('after');
let shot = null; try { await p.screenshot({ path: '/tmp/claude-1000/xrexit-after.png', timeout: 20000 }); shot = 'saved'; } catch (e) { shot = 'FAILED ' + e.message.split('\n')[0]; }
const loop = await p.evaluate(async () => { const { renderer } = await import('/lib/core.js'); const { perf } = await import('/lib/perf.js'); const f0 = perf.frames; await new Promise((r) => setTimeout(r, 1500)); return { framesIn1500ms: perf.frames - f0, drawCalls: renderer.info.render.calls }; });
const tail = await p.evaluate(() => globalThis.__tee.filter((l) => /leave|session end|after-exit|THREW/.test(l)).slice(-6));
const byPhase = {}; for (const e of errs) { const k = e.split(' ')[0]; byPhase[k] = (byPhase[k] || 0) + 1; }
const firstOf = (k) => errs.find((e) => e.startsWith(k + ' '));
console.log(JSON.stringify({ before, entered, during, after, shot, loop, tail, errCounts: byPhase, firstExitErr: firstOf('exit'), firstPresentErr: firstOf('present'), firstEnterErr: firstOf('enter') }, null, 1));
await b.close();
