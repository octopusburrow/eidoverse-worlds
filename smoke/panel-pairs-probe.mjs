// Desktop-vs-quad pairs for every staged frame: a PNG per frame (desktop clip | quad texture) plus mean luma. R 09-05 23:17: 'careful side-by-side of each one'.
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
import sharp from '/home/claude/eido/staging/node_modules/sharp/lib/index.js';
import fs from 'node:fs';
const OUT = process.argv[3] ?? '/tmp/claude-1000/xrsim/pairs'; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
await page.goto(process.argv[2]); await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForTimeout(1500); try { await page.click('.sp-skip', { timeout: 3000 }); } catch {} await page.waitForSelector('#splash.gone', { timeout: 60000 }); await page.waitForTimeout(800);
const mean = async (buf) => { const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); let l = 0, n = 0; for (let i = 0; i < data.length; i += info.channels) { l += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; } return +(l / n).toFixed(1); };
const ids = await page.evaluate(async () => { const fr = await import('/lib/frames.js'); return fr.allFrames().map(f => f.id ?? f.el?.dataset?.id).filter(Boolean); });
const rows = [];
for (const id of ids) {
  const rect = await page.evaluate(async (id) => { const fr = await import('/lib/frames.js'); const s = fr.getFrame(id); if (!s) return null; s.show(); s.el.style.zIndex = 999; await new Promise(r => setTimeout(r, 300)); const r = s.el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, id);
  if (!rect || rect.w < 4 || rect.h < 4) { rows.push({ id, skipped: true }); continue; }
  const desk = await page.screenshot({ clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(rect.w, 1400 - rect.x), height: Math.min(rect.h, 900 - rect.y) } });
  fs.writeFileSync(`${OUT}/${id}-desktop.png`, desk);
  rows.push({ id, rect, deskLuma: await mean(desk) });
  await page.evaluate(async (id) => { const fr = await import('/lib/frames.js'); fr.getFrame(id).el.style.zIndex = ''; }, id);
}
const quads = await page.evaluate(async () => { const dq = await import('/lib/domquad.js'); const xr = await import('/lib/xr.js'); dq.domQuadsEnter(xr.xrRig()); await new Promise(r => setTimeout(r, 1500)); const out = {}; for (const id of dq.domQuadIds()) { const t = dq.domQuadTexture(id); out[id] = t?.image?.toDataURL?.('image/png') ?? null; } return out; });
for (const row of rows) { const png = quads[row.id]; if (!png) continue; const buf = Buffer.from(png.split(',')[1], 'base64'); fs.writeFileSync(`${OUT}/${row.id}-quad.png`, buf); row.quadLuma = await mean(buf); }
for (const row of rows) { if (!row.rect || !quads[row.id]) continue; const d = sharp(`${OUT}/${row.id}-desktop.png`), q = sharp(`${OUT}/${row.id}-quad.png`); const dm = await d.metadata(), qm = await q.metadata(); const H = Math.max(dm.height, qm.height); const dl = await d.png().toBuffer(), ql = await q.png().toBuffer();
  await sharp({ create: { width: dm.width + qm.width + 24, height: H, channels: 4, background: '#ff00ff' } }).composite([{ input: dl, left: 0, top: 0 }, { input: ql, left: dm.width + 24, top: 0 }]).png().toFile(`${OUT}/${row.id}-pair.png`); }
console.log(JSON.stringify(rows)); await b.close();
