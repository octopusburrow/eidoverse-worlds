// ui-shots — screenshot the CHROME (not the world) for CSS work.
// Joins a live origin, opens each UI surface, saves /tmp/ui-*.png.
// The canvas may be black (no SwiftShader warm) — the pixels that matter
// here are DOM.  Usage: JOIN_KEY=… node tools/ui-shots.mjs [origin]
import { launchBrowser } from './probe-harness.mjs';

const ORIGIN = process.argv[2] || 'http://127.0.0.1:8960';
const KEY = process.env.JOIN_KEY || 'dev';

const { page, close } = await launchBrowser();
try {
  const pg = await page();
  await pg.setViewportSize({ width: 1440, height: 900 });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`${ORIGIN}/?world=staging&name=uiprobe&key=${KEY}`, { waitUntil: 'networkidle' });
  await new Promise(r => setTimeout(r, 6000));

  const shot = (n) => pg.screenshot({ path: `/tmp/ui-${n}.png` });

  await shot('0-default');

  // ∃ menu open (arranging mode — headers appear)
  await pg.click('#hud');
  await new Promise(r => setTimeout(r, 600));
  await shot('1-emenu-open');

  // close-up of the dock corner
  await pg.screenshot({ path: '/tmp/ui-2-dock-closeup.png', clip: { x: 0, y: 0, width: 320, height: 480 } });

  // chat: make sure it's open, then pop the gear
  await pg.evaluate(() => { document.querySelector('#hud')?.click(); }); // close menu
  await new Promise(r => setTimeout(r, 400));
  const gear = await pg.$('.chat-gear');
  if (gear) {
    await gear.click();
    await new Promise(r => setTimeout(r, 500));
    await shot('3-chat-gearpop');
    const box = await (await pg.$('.chat-frame')).boundingBox();
    if (box) await pg.screenshot({ path: '/tmp/ui-4-gearpop-closeup.png', clip: box });
  } else console.log('no .chat-gear found');

  // settings frame with sections open (scrollbars)
  await pg.evaluate(() => {
    document.querySelector('.chat-gearpop')?.setAttribute('hidden', '');
    for (const b of document.querySelectorAll('#dock button')) {
      if (/settings/i.test(b.title || b.getAttribute('aria-label') || '')) b.click();
    }
  });
  await new Promise(r => setTimeout(r, 500));
  await pg.evaluate(() => {
    const f = [...document.querySelectorAll('.frame')].find(f => f.querySelector('.stack'));
    f?.querySelectorAll('.sec > .head').forEach((h, i) => { if (i < 3) h.click(); });
  });
  await new Promise(r => setTimeout(r, 500));
  await shot('5-settings-open');

  console.log('frames present:', await pg.evaluate(() =>
    [...document.querySelectorAll('.frame')].map(f => f.className).join(' | ')));
  if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
  console.log('done — /tmp/ui-*.png');
} finally { await close(); }
