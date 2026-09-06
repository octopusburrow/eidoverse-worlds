// C16 probe (DOM level; the quad click-through is proven for every frame in domquad.js):
// focus the chat line, press h·i·⏎ on the REAL key buttons → chat sends "hi", the line clears.
import { chromium } from '/home/claude/eido/staging/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
await page.addInitScript(() => { try { localStorage.setItem('ew-name-set', '1'); } catch {} });
const NAME = 'kbd' + (Date.now() % 100000);
await page.goto('http://localhost:8960/?world=staging&name=' + NAME + '&key=EK4sECff0YegRuB2uo5pMpJ5&webgl=1');
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 120000 });
await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const { getFrame } = await import('/lib/frames.js');
  const kb = getFrame('keyboard'); if (!kb) return { noFrame: true };
  kb.show();
  const line = document.getElementById('chatline'); line.focus();
  const key = (k) => kb.el.querySelector('.kb-key[data-k="' + k + '"]');
  const press = (k) => { const el = key(k); if (!el) throw new Error('no key ' + k); el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
  press('⇧'); press('h'); press('i'); press('␣'); press('123'); press('1'); press('abc'); press('⌫');
  const typed = line.value;
  press('⏎');
  await new Promise(r => setTimeout(r, 1200));
  const log = [...document.querySelectorAll('[data-frame=chat] .fr-body *')].map(n => n.textContent).join('\n');
  return { xr: kb.xr === true, keys: kb.el.querySelectorAll('.kb-key').length, typed, afterEnter: line.value, said: /\bHi \b|Hi$/m.test(log) || log.includes('Hi'), hidden: !kb.visible };
});
console.log(JSON.stringify({ NAME, ...r, errs }));
await b.close();
