import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
import sharp from '/home/claude/eido/staging/node_modules/sharp/lib/index.js';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto('http://localhost:8960/?world=staging&name=luma3510&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1&xrsim=1'); await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 }); await page.waitForTimeout(2500);
// desktop: open the settings frame, screenshot its rect
const rect = await page.evaluate(async () => { const fr = await import('/lib/frames.js'); const s = fr.getFrame('settings'); fr.showFrame?.('settings', true) ?? s?.show?.(); await new Promise(r => setTimeout(r, 400)); const r = s.el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vis: getComputedStyle(s.el).display, bg: getComputedStyle(s.el).backgroundColor }; });
const shot = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: Math.max(1, rect.w), height: Math.max(1, rect.h) } });
const mean = async (buf) => { const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); let l = 0, n = 0; for (let i = 0; i < data.length; i += info.channels) { l += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; } return +(l / n).toFixed(1); };
const desk = await mean(shot);
// VR: stage the frames, read the settings quad texture
const png = await page.evaluate(async () => { const dq = await import('/lib/domquad.js'); const xr = await import('/lib/xr.js'); dq.domQuadsEnter(xr.xrRig()); await new Promise(r => setTimeout(r, 1200)); const t = dq.domQuadTexture('settings'); return t?.image?.toDataURL('image/png') ?? null; });
const quad = png ? await mean(Buffer.from(png.split(',')[1], 'base64')) : null;
if (png) (await import('node:fs')).writeFileSync('/tmp/claude-1000/xrsim/luma-quad.png', Buffer.from(png.split(',')[1], 'base64'));
(await import('node:fs')).writeFileSync('/tmp/claude-1000/xrsim/luma-desk.png', shot);
console.log(JSON.stringify({ rect, deskMeanLuma: desk, quadMeanLuma: quad }));
await b.close();
