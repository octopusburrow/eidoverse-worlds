// editpanels-bench — the Hierarchy and Inspector frames actually PAINT and
// EDIT, in a real browser, against an owned world.
//
//   bun tools/editpanels-bench.ts
//
// panels-test.ts binds the factory headless; this is the seam it cannot see:
// the frames mount in the real dock, edit mode shows them, a placed light
// (no asset needed — and the one component with a registered editor) lands
// in the tree, its channels and its `light` group render from ONE fields
// declaration, and a typed `+=4` on brightness reaches the light through
// dispatch → updateLight → the coalesced `light` verb.

import { scratchBench, mkCheck, sleep } from './harness.ts';

const { cdp, evalJson, cleanup, die, BASE } = await scratchBench('editpanels');
const { check, tally } = mkCheck();

// Headless Chrome (no working swap chain) delivers rAF callbacks late — the
// trace showed a repaint requested at t=1304 land at t=2838. The panels
// coalesce repaints on rAF by design, so the bench WAITS for the paint
// instead of sleeping a guess.
const waitFor = async (expr: string, ms = 6000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evalJson(expr)) return true; await sleep(100); }
  return false;
};

await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs = [];
    addEventListener('error', (e) => __errs.push('error: ' + e.message));
    const ce = console.error.bind(console);
    console.error = (...a) => { __errs.push('console: ' + a.map(String).join(' ')); ce(...a); };`,
});
await cdp.send('Page.navigate', { url: `${BASE}/?name=editbot&world=editbench` });

{
  let secs = 0;
  for (let i = 0; i < 120 && secs < 4; i++) {
    secs = (await evalJson(`document.querySelectorAll('.sec').length`)) ?? 0;
    if (secs < 4) await sleep(500);
  }
  check('client boots', secs >= 4, `${secs} sections`);
}

console.log('\nedit mode shows the two frames:');
check('frames exist before edit mode, hidden', await evalJson(`[...document.querySelectorAll('.frame.edit')].length === 2 && [...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display === 'none')`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' })), true`);
check('B shows both', await waitFor(`[...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display !== 'none')`));
check('titles are Hierarchy / Inspector', await evalJson(`[...document.querySelectorAll('.frame.edit .fr-title')].map((t) => t.textContent).sort().join('|') === 'Hierarchy|Inspector'`));
check('empty world: hierarchy says so', await evalJson(`!!document.querySelector('#frame-hierarchy .sp-empty, .frame.edit .sp-empty')`));
check('nothing selected: inspector says so', await evalJson(`/nothing selected/.test(document.querySelector('.frame.edit .sp-info')?.textContent ?? '')`));

console.log('\na placed light lands in the tree and the inspector:');
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('light', { id: 'benchlamp', pos: [1, 1, 1], color: 0xffd9a0, intensity: 16, range: 10 })), true`);
{
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { ok = await evalJson(`import('/lib/world.js').then((m) => !!m.entities.get('benchlamp'))`); if (!ok) await sleep(200); }
  check('the light folded locally', ok);
}
check('tree row appears (after the coalesced repaint)', await waitFor(`[...document.querySelectorAll('.frame.edit .sp-tree-row .sp-item-label')].some((l) => /benchlamp/.test(l.textContent))`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`!!document.querySelector('.frame.edit .sp-tree-row.active')`);
const insp = `[...document.querySelectorAll('.frame.edit')].find((f) => /Inspector/.test(f.querySelector('.fr-title')?.textContent))`;
check('row is active', await evalJson(`!!document.querySelector('.frame.edit .sp-tree-row.active')`));
check('channels: pos x/y/z + light brightness + range', await evalJson(`(() => { const L = [...${insp}.querySelectorAll('.sp-f-num .sp-label')].map((l) => l.textContent); return L.includes('pos x') && L.includes('pos z') && L.includes('light · brightness') && L.includes('light · range') && !L.includes('yaw'); })()`), 'a light has no yaw');
check('the light group renders from the registry', await evalJson(`[...${insp}.querySelectorAll('.sp-group')].some((g) => /light/.test(g.textContent)) && !!${insp}.querySelector('input[type=color]')`));
check('lock / keep / noon toggles', await evalJson(`${insp}.querySelectorAll('input[type=checkbox]').length >= 3`));
check('compact channels have no bumpers', await evalJson(`${insp}.querySelectorAll('.sp-step.compact .sp-bump').length === 0 && ${insp}.querySelectorAll('.sp-step.compact').length >= 5`));
check('grey scope: no seafoam on the edit frame', await evalJson(`getComputedStyle(${insp}).getPropertyValue('--brand').trim() !== '#8fe8c8'`));

console.log('\nediting through the channel box reaches the light:');
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'light · brightness').querySelector('.sp-num'); i.value = '+=4'; i.dispatchEvent(new Event('change')); return true; })()`);
check('brightness is 20 on the light', await waitFor(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.intensity === 20)`));
check('…and the light group agrees (same declaration, two lanes)', await waitFor(`[...${insp}.querySelectorAll('.sp-f-num')].filter((r) => /brightness/.test(r.querySelector('.sp-label').textContent)).every((r) => r.querySelector('.sp-num').value === '20')`));
await sleep(1500);   // past EDIT_COMMIT_MS and the echo: a refusal would have rolled it back by now
check('…and it stayed (the verb was accepted, not rolled back)', (await evalJson(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.intensity)`)) === 20);

console.log('\nthe legacy World›Scene section still gets the light editor (adapter):');
await evalJson(`document.querySelector('#sec-scene .head')?.click(), true`);
check('scene section renders the light fields through editorsFor', await waitFor(`!!document.querySelector('#sec-scene [data-fe] .sp-num')`));
if (process.env.EDIT_SHOT) {   // a look, not a trust: the grey scope is a design claim
  const shot = await cdp.send<any>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(process.env.EDIT_SHOT, Buffer.from(shot.data, 'base64'));
  console.log(`  screenshot → ${process.env.EDIT_SHOT}`);
}

console.log('\nleaving:');
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);
await sleep(200);
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);   // deselect, then leave
check('Esc hides the frames', await waitFor(`[...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display === 'none')`));
const errs: string[] = (await evalJson(`window.__errs`)) ?? [];
const mine = errs.filter((e) => /editpanels|panels\.js|inspect\.js|lights\.js|scenegraph/.test(e));
check('no page errors from the edit surface', mine.length === 0, mine.slice(0, 3).join(' | '));

console.log(`\n${tally.passed} passed, ${tally.failed} failed`);
if (tally.failed) await die(1, 'editpanels-bench: FAILED');
await cleanup();
process.exit(0);
