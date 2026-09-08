// serve-renderer — keep ONE persistent headless renderer joined to a live world,
// so /snap and the seat's `snapshot` tool have eyes. (2026-08-31, the staging
// corollary of S3: the warm takes ~54s on SwiftShader; patience IS the protocol.)
//
//   JOIN_KEY=<key> node tools/serve-renderer.mjs [origin] [world]
//   defaults: http://127.0.0.1:8960 staging
//
// Flags per web-vr.md 08-20 S3 closure: WebGL (NO --enable-unsafe-webgpu — the
// GPU device gets LOST under real scenes on SwiftShader-WebGPU), plus the three
// anti-throttle flags (a backgrounded page misses heartbeats → leave/rejoin
// churn → "not in local scene" at snap time).
import { chromium } from 'playwright';
const origin = process.argv[2] || 'http://127.0.0.1:8960';
const world  = process.argv[3] || 'staging';
const key = process.env.JOIN_KEY;
if (!key) { console.error('JOIN_KEY required'); process.exit(1); }
const extra = (process.env.EXTRA_CHROME_ARGS || '').split(/\s+/).filter(Boolean);
const b = await chromium.launch({ args: [ ...extra,
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
]});
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0,200)));
await page.addInitScript(() => {
  // FRAME GOVERNOR (2026-09-01): SwiftShader + unthrottled RAF burned 12 cores
  // all night (web-vr.md 08-31). Full rate for the first 120s (shader warm),
  // then ~5fps idle; a snap request restores full rate for 20s so /snap views
  // are fresh. Snap detection: the client answers over the ws with type
  // "snap-result" — we hook WebSocket.send. Belt+braces: also hook incoming.
  let boostUntil = Date.now() + 120000;
  let bump = () => { boostUntil = Date.now() + 20000; };
  const S = WebSocket.prototype.send;
  WebSocket.prototype.send = function(d) {
    try { if (typeof d === 'string' && d.includes('"type":"snap-result"')) bump(); } catch {}
    return S.call(this, d);
  };
  const AEL = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function(t, fn, o) {
    if (t === 'message' && typeof fn === 'function') {
      const wrapped = (ev) => { try { if (typeof ev.data === 'string' && /"type":"snap"[,}]/.test(ev.data)) bump(); } catch {} return fn(ev); };
      return AEL.call(this, t, wrapped, o);
    }
    return AEL.call(this, t, fn, o);
  };
  window.__gov = { native: 0, throttled: 0, boosts: 0 };
  const bump0 = bump;
  bump = () => { window.__gov.boosts++; bump0(); };
  const RAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (Date.now() < boostUntil) { window.__gov.native++; return RAF(cb); }
    window.__gov.throttled++;
    return setTimeout(() => cb(performance.now()), 500);
  };
});
const url = `${origin}/?world=${world}&name=eyes&key=${encodeURIComponent(key)}&renderer=1`;
console.log('joining', url.replace(key, '<key>'));
await page.goto(url);
// prove the join at protocol level, not by looking at the HUD (join-probe lesson)
await page.waitForFunction(() => window.EW?.entities?.size > 0 || window.EW?.foldParity, { timeout: 120000 }).catch(()=>{});
const n = await page.evaluate(() => window.EW?.entities?.size ?? -1).catch(()=>-1);
console.log(`joined; folded entities: ${n}; warming shaders now (~60s on SwiftShader) — staying up.`);
setInterval(async () => {
  const alive = await page.evaluate(() => !!window.EW).catch(() => false);
  const gov = await page.evaluate(() => window.__gov).catch(() => null);
  console.log('[gov]', JSON.stringify(gov));
  if (!alive) { console.error('page lost — exiting for supervisor restart'); process.exit(2); }
}, 60000);
