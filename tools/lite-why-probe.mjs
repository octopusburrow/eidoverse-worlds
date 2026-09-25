// bun tools/lite-why-probe.mjs — a desktop demoted to the light version after a recorded crash (the tripwire,
// index.html) is TOLD so, with a way out: the #lite-why banner names the reason; "Load the full world" boots the FULL
// client (?lite=0); "Stay light" saves the choice and hides the banner. A light version asked for by URL shows no
// banner. The owner, 09-24: "Why no load-the-world button then?"
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser();
try {
  const pg = await page();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  const url = `${world.origin}/?world=staging&name=litewhy&key=${world.key}`;
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('ew-boot-attempt:staging', String(Date.now() - 60000)); });
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  const b = await pg.evaluate(() => { const e = document.querySelector('#lite-why'); const r = e?.getBoundingClientRect();
    return { lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, text: e?.querySelector('p')?.textContent ?? null,
      buttons: [...(e?.querySelectorAll('button') ?? [])].map((x) => x.textContent), onScreen: !!r && r.top >= 0 && r.bottom <= innerHeight && r.width > 200 }; });
  console.log('   ', JSON.stringify(b));
  check('a crash-demoted load is the light version, why = crash', b.lite === true && b.why === 'crash', b);
  check('…and the banner says why, on screen', /didn't finish loading/.test(b.text ?? '') && b.onScreen, b);
  check('…with "Load the full world" and "Stay light"', b.buttons.join('|') === 'Load the full world|Stay light', b.buttons);
  await pg.screenshot({ path: process.env.LW_SHOT ?? '/tmp/lite-why.png' });
  await Promise.all([pg.waitForNavigation({ timeout: 60000 }), pg.click('#lite-why button[data-act=full]')]);
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 90000 });
  const full = await pg.evaluate(() => ({ lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, q: location.search }));
  check('"Load the full world" boots the FULL client (?lite=0)', full.lite === false && /lite=0/.test(full.q), full);
  // stay light: back to a crash-demoted load, click stay
  await pg.evaluate(() => localStorage.setItem('ew-boot-attempt:staging', String(Date.now() - 60000)));
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp && document.querySelector('#lite-why'), null, { timeout: 60000 });
  await pg.click('#lite-why button[data-act=stay]');
  const stay = await pg.evaluate(() => ({ gone: !document.querySelector('#lite-why'), saved: localStorage.getItem('ew-lite') }));
  check('"Stay light" hides the banner and saves the choice', stay.gone && stay.saved === '1', stay);
  // asked-for lite: no banner
  await pg.evaluate(() => { localStorage.clear(); });
  await pg.goto(url + '&lite=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 60000 }); await pg.waitForTimeout(1000);
  const asked = await pg.evaluate(() => ({ lite: globalThis.__ewLite, why: globalThis.__ewLiteWhy, banner: !!document.querySelector('#lite-why') }));
  check('a light version asked for by URL shows no banner', asked.lite === true && asked.why === 'url' && !asked.banner, asked);
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
