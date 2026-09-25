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
  // the ↻ chip's POST is intercepted — the probe must never rebuild anything real — and recorded
  const rebuilds = [];
  await pg.route('**/rebuild?**', async (route) => {
    rebuilds.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, queued: ['ktx2', 'lod'] }) });
  });
  await pg.goto(`${world.origin}/?world=staging&name=badgeprobe&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp && document.querySelector('#sec-build .head'), null, { timeout: 60000 });
  const r = await pg.evaluate(async () => {
    // the panel's OPENING cards (the starters, before any search) carry status too
    document.querySelector('#sec-build .head').click();
    for (let i = 0; i < 60 && !document.querySelector('#sec-build .grid .card .opt-rank'); i++) await new Promise((res) => setTimeout(res, 100));
    const opening = [...document.querySelectorAll('#sec-build .grid .card')].map((c) => ({ name: c.querySelector('span')?.textContent, rank: c.querySelector('.opt-rank')?.dataset.rank ?? null }));
    document.querySelector('#sec-build .head').click();
    globalThis.__opening = opening;
    const Q = 'glb';   // every filename-scored entry matches; store entries match on their manifest names or not at all
    document.querySelector('#sec-build .head').click();
    for (let i = 0; i < 40 && !document.querySelector('#sec-build input[type=search]'); i++) await new Promise((res) => setTimeout(res, 100));
    const input = document.querySelector('#sec-build input[type=search]');
    input.value = Q; input.dispatchEvent(new Event('input'));
    const json = await (await fetch(`/library-models?q=${Q}`)).json();
    for (let i = 0; i < 60 && document.querySelectorAll('#sec-build .grid .card').length < json.length; i++) await new Promise((res) => setTimeout(res, 100));
    const cards = [...document.querySelectorAll('#sec-build .grid .card')].map((c) => ({ name: c.querySelector('span')?.textContent, cardTitle: c.title,
      // tooltips live on the pill (perf + status) and the chips (status) — the hover text is theirs, not the card's
      title: [c.querySelector('.opt-rank')?.title, ...[...c.querySelectorAll('.opt-chip')].map((x) => x.title)].filter(Boolean).join('\n'), chip: [...c.querySelectorAll('.opt-chip')].map((x) => x.textContent).join('') || null,
      rank: c.querySelector('.opt-rank')?.dataset.rank ?? null,
      // measured against the PICTURE: the row sits on the image's bottom-right, clear of its top label strip and the name
      box: (() => { const im = c.querySelector('.pv img, .pv > div')?.getBoundingClientRect(), row = c.querySelector('.opt-row')?.getBoundingClientRect();
        return row && im ? { bottom: +(im.bottom - row.bottom).toFixed(1), right: +(im.right - row.right).toFixed(1), topHalf: row.top < im.top + im.height / 2, below: row.bottom > im.bottom } : null; })(),
      gaps: (() => { const els = [...c.querySelectorAll('.opt-row > *')].map((e) => e.getBoundingClientRect()); return els.slice(1).map((e, i) => +(e.left - els[i].right).toFixed(1)); })() }));
    // ↻ on the stale synthetic card: its own click must never reach the card (the card's click holds a placement ghost)
    const stale = [...document.querySelectorAll('#sec-build .grid .card')].find((c) => c.querySelector('span')?.textContent === 'zz synthetic stale');
    const plain = [...document.querySelectorAll('#sec-build .grid .card')].find((c) => !c.querySelector('.opt-chip') && c.querySelector('.opt-rebuild'));
    let cardClicked = 0; if (stale) stale.onclick = () => { cardClicked++; };
    const chip = stale?.querySelector('.opt-rebuild');
    const toasts = [];
    const mo = new MutationObserver(() => { for (const t of document.querySelectorAll('.toast, #toast, [class*=toast]')) toasts.push(t.textContent); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    chip?.click();
    for (let i = 0; i < 30 && chip?.textContent !== '↻'; i++) await new Promise((res) => setTimeout(res, 100));
    await new Promise((res) => setTimeout(res, 300)); mo.disconnect();
    const { CONFIG } = await import('./lib/base.js');
    const reb = { present: !!chip, cardClicked, staleOpacity: chip?.style.opacity, plainOpacity: plain?.querySelector('.opt-rebuild')?.style.opacity,
      everyCard: [...document.querySelectorAll('#sec-build .grid .card')].every((c) => c.querySelector('.opt-rebuild')),
      token: CONFIG.token ?? '', tip: chip?.title ?? null, toast: toasts.find((t) => /rebuild/.test(t)) ?? null, after: chip?.textContent };
    return { json, cards, reb, opening: globalThis.__opening };
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
  // ONE tooltip at a time: card → its ↻ chip with the real mouse. While the chip's house tip shows, the card must hold no
  // native title (else Chrome paints it beside ours — R, 09-24 22:29); after leaving, both titles are back.
  const cardSel = '#sec-build .grid .card:nth-child(1)';
  await pg.hover(cardSel, { position: { x: 20, y: 20 } }); await pg.waitForTimeout(600);
  await pg.hover(`${cardSel} .opt-rebuild`); await pg.waitForTimeout(700);
  const onChip = await pg.evaluate((sel) => ({ cardTitle: document.querySelector(sel).getAttribute('title'),
    tip: document.querySelector('#tipchip.show')?.textContent ?? null }), cardSel);
  await pg.mouse.move(5, 5); await pg.waitForTimeout(300);
  const after = await pg.evaluate((sel) => ({ cardTitle: document.querySelector(sel).getAttribute('title'), chipTitle: document.querySelector(`${sel} .opt-rebuild`).getAttribute('title') }), cardSel);
  console.log('   tooltip handoff:', JSON.stringify({ onChip, after }));
  check('hovering the ↻ chip shows ONLY its tip (the card holds no native title meanwhile)', onChip.cardTitle === null && /^rebuild GPU textures/.test(onChip.tip ?? ''), onChip);
  check('…and both titles come back on leave', !!after.cardTitle && /^rebuild/.test(after.chipTitle ?? ''), after);
  const q = rebuilds[0] ? new URL(rebuilds[0].url).searchParams : null;
  console.log('   rebuild:', JSON.stringify({ ...r.reb, requests: rebuilds.length }));
  check('↻ on every card; full strength on a card with a warning, dim otherwise', r.reb.everyCard && r.reb.staleOpacity === '1' && r.reb.plainOpacity === '0.55', r.reb);
  check('↻ click: ONE POST /rebuild with the card\'s path and the page\'s token', rebuilds.length === 1 && rebuilds[0].method === 'POST'
    && q.get('path') === 'store/syn-stale.glb' && (q.get('token') ?? '') === r.reb.token, rebuilds);
  check('↻ says what it does on hover (its own title, not the card\'s status list)', /^rebuild GPU textures \+ LOD/.test(r.reb.tip ?? ''), r.reb.tip);
  check('↻ click never reaches the card (no placement ghost)', r.reb.cardClicked === 0, r.reb.cardClicked);
  check('↻ click tells the person what is rebuilding, and the chip comes back', /GPU textures \+ LOD/.test(r.reb.toast ?? '') && r.reb.after === '↻', [r.reb.toast, r.reb.after]);
  console.log('   opening cards:', JSON.stringify(r.opening));
  check('the OPENING (starter) cards carry the rank pill too', r.opening.length >= 6 && r.opening.every((c) => c.rank != null), r.opening);
  check('card tooltip = just the model name; the numbers are on the pill', r.cards.every((c) => c.cardTitle && !/perf|tris|GPU textures/.test(c.cardTitle)), r.cards.slice(0, 2).map((c) => c.cardTitle));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
