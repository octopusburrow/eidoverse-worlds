import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const KEY = readFileSync(process.env.HOME + '/.config/burrow-vault/eido-staging-join-token.txt', 'utf8').trim();
const URL = 'https://northern-hewlett-displayed-graphics.trycloudflare.com';
const out = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 1100, height: 750 }, deviceScaleFactor: 2 });
pg.on('pageerror', e => console.log('PAGEERR', e.message));
await pg.addInitScript(() => { try { localStorage.setItem('ew-dock-pins', JSON.stringify(['profile','emotes','debug'])); } catch {} });
await pg.goto(`${URL}/?world=staging&name=fb&key=${KEY}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForSelector('#splash.gone', { state: 'attached', timeout: 150000 });
await new Promise(r => setTimeout(r, 5000));
const cl = await pg.context().newCDPSession(pg);
async function shootDock(name, hoverBtnId) {
  if (hoverBtnId) {
    const p = await pg.evaluate((id) => { const bt = document.querySelector(`button[data-toggles="${id}"]`); const r = bt.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }, hoverBtnId);
    await pg.mouse.move(p.x, p.y);
  } else await pg.mouse.move(700, 400);
  await new Promise(r => setTimeout(r, 450));
  const r = await pg.evaluate(() => { const el = document.getElementById('dock'); const rr = el.getBoundingClientRect(); return { x: rr.x, y: rr.y, w: rr.width, h: rr.height }; });
  const { data } = await cl.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0,r.x-6), y: Math.max(0,r.y-6), width: r.w+12, height: r.h+12, scale: 3 } });
  writeFileSync(name, Buffer.from(data, 'base64'));
}
const st = await pg.evaluate(() => [...document.querySelectorAll('button[data-toggles]')].map(b2 => ({ id: b2.dataset.toggles, on: b2.classList.contains('on'), hid: b2.hidden })));
console.log('BTNS', JSON.stringify(st));
await shootDock(`/tmp/${out}-rest.png`);
await shootDock(`/tmp/${out}-hover-on.png`, 'world');
await shootDock(`/tmp/${out}-hover-off.png`, 'profile');
await b.close();
