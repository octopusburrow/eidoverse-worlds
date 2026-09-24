// bun tools/library-badge-probe.mjs — World › Build library cards show each model's optimization status
// (palette.js optBadge over /library-models `opt`): refused/deferred/stale → ⚠ chip; a built LOD → 'LOD' chip; the
// hover (title) lists every pass with its reason. Searches broadly so the page renders the server's real catalog, then
// checks every card against the JSON the route returned for the same query.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
const { browser, page } = await launchBrowser();
try {
  const pg = await page();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  // the real catalog has no stale/deferred entries today — without these the ⚠ rule for them would pass on an
  // EMPTY measurement. Append synthetic entries (every state the server can emit) to the real response.
  const SYN = [
    { path: 'store/syn-stale.glb', name: 'zz synthetic stale', preview: null, opt: { min: { state: 'built', reason: null }, ktx2: { state: 'built', reason: null }, lod: { state: 'stale', reason: 'not smaller (1 -> 2)' } } },
    { path: 'store/syn-deferred.glb', name: 'zz synthetic deferred', preview: null, opt: { min: { state: 'built', reason: null }, ktx2: { state: 'deferred', reason: 'no ktx encoder on this host' }, lod: { state: 'pending', reason: null } } },
    { path: 'store/syn-pending.glb', name: 'zz synthetic pending', preview: null, opt: { min: { state: 'pending', reason: null }, ktx2: { state: 'pending', reason: null }, lod: { state: 'pending', reason: null } } },
  ];
  await pg.route('**/library-models?**', async (route) => {
    const res = await route.fetch(); const j = await res.json();
    await route.fulfill({ response: res, body: JSON.stringify([...j, ...SYN]), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.goto(`${world.origin}/?world=staging&name=badgeprobe&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp && document.querySelector('#sec-build .head'), null, { timeout: 60000 });
  const r = await pg.evaluate(async () => {
    const Q = 'glb';   // every filename-scored entry matches; store entries match on their manifest names or not at all
    document.querySelector('#sec-build .head').click();
    for (let i = 0; i < 40 && !document.querySelector('#sec-build input[type=search]'); i++) await new Promise((res) => setTimeout(res, 100));
    const input = document.querySelector('#sec-build input[type=search]');
    input.value = Q; input.dispatchEvent(new Event('input'));
    const json = await (await fetch(`/library-models?q=${Q}`)).json();
    for (let i = 0; i < 60 && document.querySelectorAll('#sec-build .grid .card').length < json.length; i++) await new Promise((res) => setTimeout(res, 100));
    const cards = [...document.querySelectorAll('#sec-build .grid .card')].map((c) => ({ name: c.querySelector('span')?.textContent, title: c.title, chip: [...c.querySelectorAll('.opt-chip')].map((x) => x.textContent).join('') || null,
      rank: c.querySelector('.opt-rank')?.dataset.rank ?? null,
      // measured against the PICTURE: the row sits on the image's bottom-right, clear of its top label strip and the name
      box: (() => { const im = c.querySelector('.pv img, .pv > div')?.getBoundingClientRect(), row = c.querySelector('.opt-row')?.getBoundingClientRect();
        return row && im ? { bottom: +(im.bottom - row.bottom).toFixed(1), right: +(im.right - row.right).toFixed(1), topHalf: row.top < im.top + im.height / 2, below: row.bottom > im.bottom } : null; })(),
      gaps: (() => { const els = [...c.querySelectorAll('.opt-row > *')].map((e) => e.getBoundingClientRect()); return els.slice(1).map((e, i) => +(e.left - els[i].right).toFixed(1)); })() }));
    return { json, cards };
  });
  // by INDEX, not name: display names truncate at 48 chars and two library files share one (paint keeps order)
  let mism = [];
  const counts = { warn: 0, lod: 0, none: 0 };
  for (const [i, h] of r.json.entries()) {
    const c = r.cards[i]; if (!c || c.name !== h.name) { mism.push(`card ${i} is ${c?.name} want ${h.name}`); continue; }
    const bad = Object.values(h.opt).some((v) => ['refused', 'deferred', 'stale'].includes(v.state));
    const want = ((h.opt.lod?.state === 'built' ? 'LOD' : '') + (bad ? '⚠' : '')) || null;
    if (h.perf && c.rank !== String(h.perf.rank)) mism.push(`${h.name}: rank pill ${c.rank} want ${h.perf.rank}`);
    if (h.perf && !c.title.includes(`perf if loaded (${h.perf.servedAs}): ${h.perf.rankName}`)) mism.push(`${h.name}: hover lacks the rank`);
    if (h.perfOriginal && !c.title.includes(`original upload: ${h.perfOriginal.rankName}`)) mism.push(`${h.name}: hover lacks the original's rank`);
    if (c.box && (c.box.bottom < 4 || c.box.right < 4 || c.box.topHalf || c.box.below)) mism.push(`${h.name}: corner row inset ${JSON.stringify(c.box)}`);
    if (c.gaps.some((g) => g < 3)) mism.push(`${h.name}: chips touch (gaps ${c.gaps})`);
    if (c.chip !== want) mism.push(`${h.name}: chip ${c.chip} want ${want}`);
    counts[bad ? 'warn' : want === 'LOD' ? 'lod' : 'none']++;
    for (const v of Object.values(h.opt)) if (v.reason && !c.title.includes(v.reason)) mism.push(`${h.name}: hover lacks "${v.reason}"`);
  }
  console.log(`  ${r.json.length} entries, ${r.cards.length} cards; chips ⚠ ${counts.warn}, LOD ${counts.lod}, none ${counts.none}`);
  check('the page rendered every catalog entry for the query', r.cards.length === r.json.length && r.json.length > 10, `${r.cards.length} vs ${r.json.length}`);
  check('each card\'s chip matches its status (⚠ refused/deferred/stale; LOD when built; else none)', mism.filter((m) => /chip/.test(m)).length === 0, mism.filter((m) => /chip/.test(m)).slice(0, 3));
  check('every reason the server gave is in the card\'s hover', mism.filter((m) => /hover/.test(m)).length === 0, mism.filter((m) => /hover/.test(m)).slice(0, 3));
  check('rank pill on every card with a perf record, equal to the server\'s rank, and named in the hover', mism.filter((m) => /rank/.test(m)).length === 0 && r.json.filter((h) => h.perf).length > 10, mism.filter((m) => /rank/.test(m)).slice(0, 3));
  check('the row sits on the picture\'s bottom-right (≥4px in, lower half, not below it) and its chips are ≥3px apart', mism.filter((m) => /inset|touch/.test(m)).length === 0, mism.filter((m) => /inset|touch/.test(m)).slice(0, 3));
  check('the real catalog exercises both chips', counts.warn > 0 && counts.lod > 0, counts);
  const syn = (n) => r.cards.find((c) => c.name === n);
  check('synthetic: stale → ⚠, deferred → ⚠, all-pending → no chip (nothing to warn about yet)', syn('zz synthetic stale')?.chip === '⚠' && syn('zz synthetic deferred')?.chip === '⚠' && syn('zz synthetic pending')?.chip === null, ['stale', 'deferred', 'pending'].map((k) => syn(`zz synthetic ${k}`)?.chip));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
