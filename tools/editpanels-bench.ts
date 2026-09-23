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
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__refused = []; window.__keys = []; import('/lib/base.js').then((m) => { m.bus.on('verb-refused', (e) => window.__refused.push(e?.error ?? '')); m.bus.on('key', (e) => window.__keys.push(e.code)); });` });
await cdp.send('Page.navigate', { url: `${BASE}/?name=editbot&world=editbench` });

{
  let secs = 0;
  for (let i = 0; i < 120 && secs < 4; i++) {
    secs = (await evalJson(`document.querySelectorAll('.sec').length`)) ?? 0;
    if (secs < 4) await sleep(500);
  }
  check('client boots', secs >= 4, `${secs} sections`);
  // Headless never finishes the body load (dead WebGPU swap chain), so the
  // boot splash stays at --spp 0.6, full-screen at z-100, and steals every
  // elementFromPoint below. A real browser dismisses it. Make it transparent
  // to hit-tests here; every "can a pointer reach it" check depends on this.
  await evalJson(`(() => { const s = document.querySelector('#splash'); if (s && !s.classList.contains('gone')) s.style.pointerEvents = 'none'; return true; })()`);
}

console.log('\nedit mode shows the two frames:');
check('frames exist before edit mode, hidden', await evalJson(`[...document.querySelectorAll('.frame.edit')].length === 2 && [...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display === 'none')`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' })), true`);
check('B shows both', await waitFor(`(() => { const F = [...document.querySelectorAll('.frame.edit')]; return F.length === 2 && F.every((f) => getComputedStyle(f).display !== 'none'); })()`));
check('titles are Hierarchy / Inspector', await evalJson(`[...document.querySelectorAll('.frame.edit .fr-title')].map((t) => t.textContent).sort().join('|') === 'Hierarchy|Inspector'`));
check('empty world: hierarchy says so', await evalJson(`!!document.querySelector('#frame-hierarchy .sp-empty, .frame.edit .sp-empty')`));
check('nothing selected: inspector says so', await evalJson(`/nothing selected/.test(document.querySelector('.frame.edit .sp-info')?.textContent ?? '')`));

console.log('\nthe workspace: docked columns, strips, a slim rail:');
check('hierarchy is docked in the left column, above chat', await evalJson(`(() => { const L = document.querySelector('.edit-left'); const ids = [...L.children].map((c) => c.dataset?.frame ?? c.className); return JSON.stringify(ids) === JSON.stringify(['hierarchy', 'edit-split edit-split-h', 'chat']); })()`), await evalJson(`JSON.stringify([...document.querySelector('.edit-left').children].map((c) => c.dataset?.frame ?? c.className))`));
check('inspector is docked in the right column', await evalJson(`document.querySelector('.edit-right [data-frame="inspector"]') !== null`));
check('top strip + tools column are up', await evalJson(`!document.querySelector('.edit-top').hidden && document.querySelectorAll('.edit-tools .edit-tool').length === 5`));
check('mic / ear / goggles sit IN the top bar (inside its box, hit-testable)', await evalJson(`(() => { const bar = document.querySelector('.edit-top').getBoundingClientRect(); const ok = (sel) => { const e = document.querySelector(sel); if (!e) return sel === '.xr-chip'; const r = e.getBoundingClientRect(); const inside = r.top >= bar.top && r.bottom <= bar.bottom + 1 && r.right <= bar.right; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return inside && (hit === e || e.contains(hit)); }; return ok('#micbtn') && ok('#earbtn') && ok('.xr-chip'); })()`), await evalJson(`JSON.stringify(['#micbtn','#earbtn','.xr-chip'].map((s) => { const e = document.querySelector(s); const r = e?.getBoundingClientRect(); return r ? [s, r.left|0, r.top|0, r.width|0, r.height|0] : [s, null]; }))`));
await evalJson(`document.querySelector('.edit-vbtn[data-view="wire"]').click(), true`);
check('wireframe sets a scene override material', await evalJson(`import('/lib/core.js').then((m) => !!m.scene.overrideMaterial?.wireframe)`));
await evalJson(`document.querySelector('.edit-vbtn[data-view="wire"]').click(), true`);
check('…and clears it', await evalJson(`import('/lib/core.js').then((m) => m.scene.overrideMaterial === null)`));
check('rail shows only the wrench among toggles', await evalJson(`[...document.querySelectorAll('#dock button[data-toggles]')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.dataset.toggles).join() === 'edit'`));
check('the World panel is parked (it would sit behind the Inspector)', await evalJson(`!document.querySelector('[data-frame="world"]') || getComputedStyle(document.querySelector('[data-frame="world"]')).display === 'none'`));
check('docked frames ignore their floating geometry', await evalJson(`(() => { const h = document.querySelector('[data-frame="hierarchy"]'); const cs = getComputedStyle(h); return cs.position === 'relative' && h.getBoundingClientRect().left >= 40; })()`));
await evalJson(`document.querySelector('.edit-tool[data-tool="rotate"]').click(), true`);
check('clicking a tool sets it (rotate)', await evalJson(`globalThis.__editLayout?.().tool === 'rotate'`));
await evalJson(`document.querySelector('.edit-tool[data-tool="move"]').click(), true`);
check('Edit ▾ opens a menu with undo (and it is the only one showing)', await evalJson(`(() => { [...document.querySelectorAll('.edit-menu > .edit-btn')].find((b) => /^Edit/.test(b.textContent)).click(); const shown = [...document.querySelectorAll('.edit-menu-pop')].filter((p) => getComputedStyle(p).display !== 'none'); return shown.length === 1 && [...shown[0].querySelectorAll('.edit-menu-item')].some((i) => /undo/.test(i.textContent)); })()`));
await evalJson(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
check('Esc closes the menu (computed, not the attribute)', await evalJson(`[...document.querySelectorAll('.edit-menu-pop')].every((p) => getComputedStyle(p).display === 'none')`));

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
check('grey scope: the edit frame re-points --brand to the grey', await evalJson(`getComputedStyle(${insp}).getPropertyValue('--brand').trim() === '#d2d2d6'`));

console.log('\nediting through the channel box reaches the light:');
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'light · brightness').querySelector('.sp-num'); i.value = '+=4'; i.dispatchEvent(new Event('change')); return true; })()`);
check('brightness is 20 on the light', await waitFor(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.intensity === 20)`));
check('…and the light group agrees (same declaration, two lanes)', await waitFor(`(() => { const R = [...${insp}.querySelectorAll('.sp-f-num')].filter((r) => /brightness/.test(r.querySelector('.sp-label').textContent)); return R.length >= 2 && R.every((r) => r.querySelector('.sp-num').value === '20'); })()`));
await sleep(1500);   // past EDIT_COMMIT_MS and the echo: a refusal would have rolled it back by now
check('…and it stayed (the verb was accepted, not rolled back)', (await evalJson(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.intensity)`)) === 20);

console.log('\nundo: Ctrl+Z after a light edit restores the fold value:');
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, bubbles: true })), true`);
check('brightness back to 16', await waitFor(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.intensity === 16)`));

console.log('\na no-op scrub on one thing must not leak its pose into the next selection:');
{
  const inpX = `[...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'pos x').querySelector('.sp-num')`;
  const pe = (t: string, x: number, extra = '') => `new PointerEvent('${t}', { clientX: ${x}, clientY: 0, button: 0, pointerId: 9, bubbles: true, isPrimary: true${extra} })`;
  // ctrl-scrub a few px and release: rounds back to the start value (a live call AT the start pose)
  await evalJson(`(() => { const i = ${inpX}; i.dispatchEvent(${pe('pointerdown', 100)}); i.dispatchEvent(${pe('pointermove', 108, ', ctrlKey: true')}); i.dispatchEvent(${pe('pointerup', 108, ', ctrlKey: true')}); return true; })()`);
  await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('light', { id: 'lamp2', pos: [5, 1, 5], color: 0xffd9a0, intensity: 8, range: 6 })), true`);
  await waitFor(`import('/lib/world.js').then((m) => !!m.entities.get('lamp2'))`);
  await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('lamp2')), true`);
  await waitFor(`${insp}.querySelector('.sp-info')?.textContent === 'lamp2'`);
  await evalJson(`(() => { const i = ${inpX}; i.dispatchEvent(${pe('pointerdown', 100)}); i.dispatchEvent(${pe('pointermove', 150)}); i.dispatchEvent(${pe('pointerup', 150)}); return true; })()`);
  check('lamp2 moved by +1 on x from ITS OWN pose (6,1,5), not benchlamp\'s', await waitFor(`import('/lib/world.js').then((m) => { const p = m.entities.get('lamp2')?.position; return p && Math.abs(p.x - 6) < 0.01 && Math.abs(p.z - 5) < 0.01; })`), await evalJson(`import('/lib/world.js').then((m) => m.entities.get('lamp2')?.position.toArray().map((v) => +v.toFixed(2)))`));
  await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
  await waitFor(`${insp}.querySelector('.sp-info')?.textContent === 'benchlamp'`);
}

console.log('\nstandard keys and the hierarchy context menu:');
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true })), true`);
check('R → scale tool (Maya\'s R; S walks)', await evalJson(`globalThis.__editLayout?.().tool === 'scale'`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true })), true`);
check('E → rotate tool', await evalJson(`globalThis.__editLayout?.().tool === 'rotate'`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true })), true`);
check('G → move tool', await evalJson(`globalThis.__editLayout?.().tool === 'move'`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })), true`);
check('W is still walking — no tool change', await evalJson(`globalThis.__editLayout?.().tool === 'move'`));
check('tool buttons show their letters', await evalJson(`[...document.querySelectorAll('.edit-tool-key')].map((k) => k.textContent).join('') === 'QGER'`));
check('hierarchy has no button row', await evalJson(`document.querySelector('.edit-left [data-frame="hierarchy"] .sp-btn') === null`));
await evalJson(`(() => { const row = [...document.querySelectorAll('.edit-left .sp-tree-row')].find((r) => /lamp2/.test(r.textContent)); row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 120, clientY: 130, bubbles: true, cancelable: true })); return true; })()`);
check('right-click opens the row menu with find / attach / lock / remove', await evalJson(`(() => { const m = document.querySelector('.sp-ctx'); const T = m ? [...m.querySelectorAll('.sp-ctx-item')].map((i) => i.textContent) : []; return T.some((t) => /find/.test(t)) && T.some((t) => /attach/.test(t)) && T.some((t) => /lock/.test(t)) && T.some((t) => /remove/.test(t)); })()`));
await evalJson(`[...document.querySelectorAll('.sp-ctx-item')].find((i) => /remove/.test(i.textContent)).click(), true`);
check('menu → remove takes lamp2 out of the world', await waitFor(`import('/lib/world.js').then((m) => !m.entities.has('lamp2'))`));
check('…and the menu is gone', await evalJson(`document.querySelector('.sp-ctx') === null`));
check('∃ and the wrench are VISIBLE on the band (elementFromPoint, not a class)', await evalJson(`(() => { const hit = (el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === el || el.contains(e); }; return hit(document.querySelector('#hud')) && hit(document.querySelector('#dock button[data-toggles="edit"]')); })()`));
check('rim is gone; the wrench wears the amber box', await evalJson(`(() => { const w = document.querySelector('#dock button[data-toggles="edit"]'); return w && w.classList.contains('on') && getComputedStyle(w).boxShadow !== 'none' && getComputedStyle(document.body, '::after').content !== '""'; })()`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent === 'benchlamp'`);

console.log('\nEsc mid-scrub, in a real browser (the key lands on the document, not the blurred input):');
{
  const pe = (t: string, x: number) => `new PointerEvent('${t}', { clientX: ${x}, clientY: 0, button: 0, pointerId: 7, bubbles: true, isPrimary: true })`;
  const inp = `[...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'light · range').querySelector('.sp-num')`;
  await evalJson(`(() => { const i = ${inp}; i.dispatchEvent(${pe('pointerdown', 100)}); i.dispatchEvent(${pe('pointermove', 130)}); i.dispatchEvent(${pe('pointermove', 160)}); return true; })()`);
  check('scrub previews (range 10 → 22 on the face)', await evalJson(`${inp}.value === '22'`), await evalJson(`${inp}.value`));
  check('…and the input is not focused while scrubbing', await evalJson(`document.activeElement !== ${inp}`));
  await evalJson(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  // a live coalesced commit may already have gone out mid-scrub; the Esc sends
  // the start value back through the same coalescer, so the restore is on the
  // WIRE one pacing interval later — wait for the face AND the fold
  check('Esc restores the face — and the fold, if a live commit had already gone out', await waitFor(`${inp}.value === '10' && import('/lib/state.js').then((m) => m.state.st.entities.benchlamp.range === 10)`, 4000), 'face=' + await evalJson(`${inp}.value`) + ' channels=' + JSON.stringify(await evalJson(`[...${insp}.querySelectorAll('.sp-f-num')].map((r) => r.querySelector('.sp-label').textContent + '=' + r.querySelector('.sp-num').value)`)) + ' fold=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => { const e = m.state.st.entities.benchlamp; return { intensity: e?.intensity, range: e?.range }; })`)));
  await evalJson(`${inp}.dispatchEvent(${pe('pointerup', 160)}), true`);
  await sleep(700);
  check('…and the light never left 10 (nothing committed)', (await evalJson(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.userData?.lightParams?.range)`)) === 10);
}

console.log('\nmotion: a bob on the light — group, driven channels, an edit that keeps t0:');
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('motion', { id: 'benchlamp', type: 'bob', amp: 0.3, period: 2 })), true`);
check('motion group renders from motion.js', await waitFor(`[...${insp}.querySelectorAll('.sp-group')].some((g) => /motion/.test(g.textContent)) && [...${insp}.querySelectorAll('select.sp-enum')].some((s) => s.value === 'bob')`));
check('pos channels are DRIVEN (rest pose, tinted)', await evalJson(`${insp}.querySelectorAll('.sp-f-num.driven').length >= 3`));
check('amp / period reach the channel box', await evalJson(`(() => { const L = [...${insp}.querySelectorAll('.sp-f-num .sp-label')].map((l) => l.textContent); return L.includes('motion · amp') && L.includes('motion · period'); })()`));
const t0 = await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.motion?.t0)`);
check('the fold stamped a t0', typeof t0 === 'number' && t0 > 0, String(t0));
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'motion · amp').querySelector('.sp-num'); i.value = '+=0.2'; i.dispatchEvent(new Event('change')); return true; })()`);
check('amp is 0.5 after +=0.2', await waitFor(`import('/lib/world.js').then((m) => Math.abs((m.comps.get('benchlamp')?.motion?.amp ?? 0) - 0.5) < 1e-9)`));
check('…and t0 was kept (no phase restart)', (await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.motion?.t0)`)) === t0);
await evalJson(`(() => { const b = [...${insp}.querySelectorAll('.sp-btn')].find((x) => /come to rest/.test(x.textContent)); b.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true })); b.click(); return true; })()`);
check('come to rest removes the motion', await waitFor(`import('/lib/world.js').then((m) => !m.comps.get('benchlamp')?.motion)`));

console.log('\nsockets: a seat on the light — list, per-slot channels, ✕ through the merged write:');
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('comp', { id: 'benchlamp', type: 'sockets', data: { seat: { pos: [0, 0.5, 0], yaw: 0 } } })), true`);
check('sockets group with the seat row', await waitFor(`[...${insp}.querySelectorAll('.sp-group')].some((g) => /sockets/.test(g.textContent)) && [...${insp}.querySelectorAll('.sp-item-label')].some((l) => l.textContent === 'seat')`));
check('seat x/y/z/yaw reach the channel box', await evalJson(`(() => { const L = [...${insp}.querySelectorAll('.sp-f-num .sp-label')].map((l) => l.textContent); return L.includes('sockets · seat x') && L.includes('sockets · seat yaw'); })()`));
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('motion', { id: 'benchlamp', type: 'spin', degPerSec: 30 })), true`);
await waitFor(`[...${insp}.querySelectorAll('select.sp-enum')].some((s) => s.value === 'spin')`);
if (process.env.EDIT_SHOT) {   // a look, not a trust: the grey scope is a design claim
  const shot = await cdp.send<any>('Page.captureScreenshot', { format: 'png' });
  await Bun.write(process.env.EDIT_SHOT, Buffer.from(shot.data, 'base64'));
  console.log(`  screenshot → ${process.env.EDIT_SHOT}`);
}
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-num')].find((r) => r.querySelector('.sp-label').textContent === 'sockets · seat yaw').querySelector('.sp-num'); i.value = '90'; i.dispatchEvent(new Event('change')); return true; })()`);
check('typing 90 into a degree channel lands as π/2 in the fold (not π/2/57)', await waitFor(`import('/lib/world.js').then((m) => Math.abs((m.comps.get('benchlamp')?.sockets?.seat?.yaw ?? 0) - Math.PI / 2) < 1e-3)`), 'yaw=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.sockets?.seat?.yaw)`)));
check('no raw-JSON row for a type an editor speaks for', await evalJson(`![...${insp}.querySelectorAll('.sp-f-text .sp-label')].some((l) => /^(sockets|motion)$/.test(l.textContent))`));
// a settle before the ✕: the bench fires verbs faster than a person, and the
// server's VERB_RATE window (12 per 4 s) is the one thing that can make this
// click do nothing with no error in the page — the detail prints refusals
await sleep(1500);
await evalJson(`(() => { const b = [...${insp}.querySelectorAll('.sp-mini.danger')].find((x) => x.textContent === '✕'); b.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true })); b.click(); return true; })()`);
check('✕ removes the only seat → sockets comp gone', await waitFor(`import('/lib/world.js').then((m) => !m.comps.get('benchlamp')?.sockets)`), 'sockets=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.sockets)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));

console.log('\nhierarchy: label · hidden · filter · disclosure · duplicate · arrows:');
await sleep(1500);   // settle: the verb-rate window (see the ✕ note above)
const hier = `[...document.querySelectorAll('.frame.edit')].find((f) => /Hierarchy/.test(f.querySelector('.fr-title')?.textContent))`;
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-text')].find((r) => r.querySelector('.sp-label')?.textContent === 'label').querySelector('.sp-text'); i.value = 'porch'; i.dispatchEvent(new Event('change')); return true; })()`);
check('label typed in Flags → the hierarchy row shows it', await waitFor(`[...${hier}.querySelectorAll('.sp-tree-row .sp-item-label')].some((l) => l.textContent === 'porch  (benchlamp)')`), 'rows=' + await evalJson(`[...${hier}.querySelectorAll('.sp-tree-row .sp-item-label')].map((l) => l.textContent).join('|')`) + ' label-comp=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.label)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
await evalJson(`(() => { const c = [...${insp}.querySelectorAll('.sp-f-check')].find((r) => r.querySelector('.sp-label')?.textContent === 'hidden').querySelector('input'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
check('hidden checkbox → the mesh is not drawn (obj.visible false, still in the fold)', await waitFor(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.visible === false && !!m.comps.get('benchlamp')?.hidden)`));
await evalJson(`(() => { const c = [...${insp}.querySelectorAll('.sp-f-check')].find((r) => r.querySelector('.sp-label')?.textContent === 'hidden').querySelector('input'); c.checked = false; c.dispatchEvent(new Event('change')); return true; })()`);
check('…and back', await waitFor(`import('/lib/world.js').then((m) => m.entities.get('benchlamp')?.visible === true)`));
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('light', { id: 'lamp3', pos: [1, 1.5, 1], color: 0xffffff, intensity: 4, range: 3 })), true`);
await waitFor(`import('/lib/world.js').then((m) => !!m.entities.get('lamp3'))`);
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('mount', { id: 'lamp3', to: 'benchlamp', offset: [0, 0.5, 0] })), true`);
check('a mounted light indents under its carrier', await waitFor(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /lamp3/.test(x.querySelector('.sp-item-label').textContent)); return !!r && parseInt(r.style.paddingLeft) > 10; })()`), 'parent=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent)`)) + ' mountedTo=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.entities.get('lamp3')?.userData?.mountedTo)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /benchlamp/.test(x.querySelector('.sp-item-label').textContent)); r.querySelector('.sp-disc').click(); return true; })()`);
check('disclosure folds the carrier: lamp3 row gone', await waitFor(`![...${hier}.querySelectorAll('.sp-tree-row .sp-item-label')].some((l) => /lamp3/.test(l.textContent))`));
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /benchlamp/.test(x.querySelector('.sp-item-label').textContent)); r.querySelector('.sp-disc').click(); return true; })()`);
check('…and unfolds', await waitFor(`[...${hier}.querySelectorAll('.sp-tree-row .sp-item-label')].some((l) => /lamp3/.test(l.textContent))`));
await evalJson(`(() => { const i = ${hier}.querySelector('.sp-f-text .sp-text'); i.value = 'zzz-nothing'; i.dispatchEvent(new Event('change')); return true; })()`);
check('a filter with no match empties the tree and says so', await waitFor(`${hier}.querySelectorAll('.sp-tree-row').length === 0 && /nothing matches/.test(${hier}.querySelector('.sp-empty')?.textContent ?? '')`));
await evalJson(`(() => { const i = ${hier}.querySelector('.sp-f-text .sp-text'); i.value = 'lamp3'; i.dispatchEvent(new Event('change')); return true; })()`);
check('a match keeps its ancestor (dimmed) and itself', await waitFor(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; return R.length === 2 && R[0].classList.contains('dim') && /lamp3/.test(R[1].textContent) && !R[1].classList.contains('dim'); })()`), await evalJson(`[...${hier}.querySelectorAll('.sp-tree-row')].map((r) => r.className + ':' + r.querySelector('.sp-item-label').textContent).join('|')`));
await evalJson(`(() => { const i = ${hier}.querySelector('.sp-f-text .sp-text'); i.value = ''; i.dispatchEvent(new Event('change')); return true; })()`);
await waitFor(`${hier}.querySelectorAll('.sp-tree-row').length >= 2`);
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);
await evalJson(`(() => { const s = ${hier}.querySelector('.schema-scroll'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true })); return true; })()`);
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'benchlamp')`);
await evalJson(`(() => { const s = ${hier}.querySelector('.schema-scroll'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true, cancelable: true })); return true; })()`);
check('↓ in the focused tree selects the next row (lamp3)', await waitFor(`import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'lamp3')`), 'sel=' + JSON.stringify(await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelected())`)) + ' rows=' + JSON.stringify(await evalJson(`globalThis.__editPanels?.().rows`)) + ' focus=' + JSON.stringify(await evalJson(`document.activeElement?.className`)) + ' inFrame=' + JSON.stringify(await evalJson(`${hier}.contains(${hier}.querySelector('.schema-scroll'))`)));
check('…and the keystroke never reached the walking keys (positive control: W did)', (await evalJson(`window.__keys.includes('KeyW')`)) && !(await evalJson(`window.__keys.includes('ArrowDown')`)), 'keys=' + JSON.stringify(await evalJson(`window.__keys.slice(-5)`)));
await evalJson(`(() => { const s = ${hier}.querySelector('.schema-scroll'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true, cancelable: true })); return true; })()`);
check('↑ selects the previous', await waitFor(`import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'benchlamp')`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', altKey: true, bubbles: true })), true`);
check('Alt+D duplicates: a new light carrying the SOURCE\'s components (minus lock), nudged', await waitFor(`import('/lib/world.js').then((m) => { const id = [...m.entities.keys()].find((k) => /^benchlamp~[0-9a-f]{4}$/.test(k)); const o = m.entities.get(id); if (!o) return false; const strip = (b) => { const c = { ...(b ?? {}) }; delete c.lock; return JSON.stringify(c); }; return strip(m.comps.get(id)) === strip(m.comps.get('benchlamp')) && Math.abs(o.position.x - 1.5) < 0.01; })`), await evalJson(`import('/lib/world.js').then((m) => { const id = [...m.entities.keys()].find((k) => /^benchlamp~[0-9a-f]{4}$/.test(k)); return JSON.stringify({ id, comps: m.comps.get(id), src: m.comps.get('benchlamp'), pos: m.entities.get(id)?.position.toArray() }); })`));
check('…and the copy is selected', await waitFor(`import('/lib/scenegraph.js').then((m) => /^benchlamp~[0-9a-f]{4}$/.test(m.sceneSelected() ?? ''))`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);

console.log('\ndrag-reparent in the tree: detach onto empty space, attach onto a row, refuse a cycle, undo:');
await sleep(1500);   // verb window
const rowOf = (id) => `[...${hier}.querySelectorAll('.sp-tree-row')].find((x) => x.querySelector('.sp-item-label').textContent.includes(${JSON.stringify('')} + ${JSON.stringify(id)}))`;
const dragTo = async (id, targetExpr) => evalJson(`(() => { const src = ${rowOf(id)}; const dst = ${targetExpr}; if (!src || !dst) return 'missing:' + !!src + !!dst; src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() })); dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); src.dispatchEvent(new DragEvent('dragend', { bubbles: true })); return 'ok'; })()`);
check('rows are draggable; riders are not', await evalJson(`${rowOf('lamp3')}?.draggable === true`));
check('lamp3 starts mounted on benchlamp', await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent?.to === 'benchlamp')`));
const d1 = await dragTo('lamp3', `${hier}.querySelector('.sp-tree')`);
check('drop onto empty tree space → detached (dismount, absolute pose stamped)', await waitFor(`import('/lib/state.js').then((m) => !m.state.st.entities.lamp3?.parent)`), d1 + ' parent=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
await sleep(600);
const d2 = await dragTo('lamp3', rowOf('porch  (benchlamp)'));
check('drop onto a row → mounted on it (in place)', await waitFor(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent?.to === 'benchlamp')`), d2 + ' parent=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent)`)));
await sleep(600);
const d3 = await dragTo('porch  (benchlamp)', rowOf('lamp3'));
await sleep(400);
check('dropping a carrier onto its own cargo is refused with a hint, nothing sent', d3 === 'ok' && await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent?.to === 'benchlamp' && !m.state.st.entities.benchlamp?.parent)`) && await evalJson(`/own cargo/.test(document.querySelector('#hintbar, .hint, #hint')?.textContent ?? document.body.textContent)`));
await evalJson(`import('/lib/build.js').then((m) => m.undo()), true`);
check('Ctrl+Z undoes the attach → detached again', await waitFor(`import('/lib/state.js').then((m) => !m.state.st.entities.lamp3?.parent)`), JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent)`)));
await sleep(600);
await evalJson(`import('/lib/build.js').then((m) => m.undo()), true`);
check('…and once more undoes the detach → mounted again with its old offset', await waitFor(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent?.to === 'benchlamp' && Math.abs((m.state.st.entities.lamp3.parent.offset ?? [0])[1] - 0.5) < 1e-6)`), JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.lamp3?.parent)`)));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);

console.log('\ngizmo: TransformControls on the selection, yaw-only rotate, one place on release, undo:');
await sleep(1200);
await evalJson(`import('/lib/build.js').then((m) => m.setTool('move')), true`);
check('move tool + a selection → the gizmo is attached to it in translate mode', await waitFor(`globalThis.__gizmo?.().attached === 'benchlamp' && globalThis.__gizmo().mode === 'translate'`), JSON.stringify(await evalJson(`(() => { const g = globalThis.__gizmo?.(); return g && { attached: g.attached, mode: g.mode }; })()`)));
check('the helper is in the scene', await evalJson(`import('/lib/core.js').then((m) => !!m.scene.getObjectByName('edit-gizmo'))`));
await evalJson(`import('/lib/build.js').then((m) => m.setTool('rotate')), true`);
check('rotate tool on a LIGHT → no gizmo (a light has no yaw)', await waitFor(`globalThis.__gizmo?.().attached === null`), JSON.stringify(await evalJson(`(() => { const g = globalThis.__gizmo?.(); return g && { attached: g.attached, mode: g.mode }; })()`)));
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('spawn', { id: 'crate1', lib: 'eidoverse/assets/models/unit_quad_picture_plane.glb', pos: [3, 0, 3], yaw: 0 })), true`);
await waitFor(`import('/lib/world.js').then((m) => !!m.entities.get('crate1'))`, 8000);
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('crate1')), true`);
check('rotate tool on a MODEL → rotate mode with only the Y ring (the log has no pitch/roll)', await waitFor(`globalThis.__gizmo?.().attached === 'crate1' && globalThis.__gizmo().mode === 'rotate' && globalThis.__gizmo().showX === false && globalThis.__gizmo().showZ === false`), JSON.stringify(await evalJson(`(() => { const g = globalThis.__gizmo?.(); return g && { attached: g.attached, mode: g.mode, lib: null }; })()`)) + ' lib=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.entityMeta.get('crate1')?.lib)`)));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await evalJson(`import('/lib/build.js').then((m) => m.setTool('move')), true`);
await waitFor(`globalThis.__gizmo?.().mode === 'translate'`);
// a drag, driven through the controls' own events (headless has no pointer on a WebGPU handle):
// begin → the object moves → change → end → ONE place with the full pose
const gx0 = await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.benchlamp.pos[0])`);
await evalJson(`(() => { const c = globalThis.__gizmo().controls; c.dispatchEvent({ type: 'dragging-changed', value: true }); return import('/lib/world.js').then((m) => { m.entities.get('benchlamp').position.x += 1; c.dispatchEvent({ type: 'objectChange' }); c.dispatchEvent({ type: 'dragging-changed', value: false }); return true; }); })()`);
check('release commits ONE place: pos.x +1 in the fold', await waitFor(`import('/lib/state.js').then((m) => Math.abs(m.state.st.entities.benchlamp.pos[0] - (${gx0} + 1)) < 1e-6)`), 'x=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.benchlamp.pos)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
await sleep(600);
await evalJson(`import('/lib/build.js').then((m) => m.undo()), true`);
check('undo puts it back — and pops the GIZMO\'s entry, not an older one (the copy still exists)', await waitFor(`import('/lib/state.js').then((m) => Math.abs(m.state.st.entities.benchlamp.pos[0] - ${gx0}) < 1e-6 && Object.keys(m.state.st.entities).some((k) => /^benchlamp~/.test(k)))`), JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => Object.keys(m.state.st.entities))`)));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`globalThis.__gizmo?.().attached === 'benchlamp'`);
await evalJson(`import('/lib/inspect.js').then((m) => m.commitEdit('benchlamp', 'flags.lock', true)), true`);
check('locking the thing detaches the gizmo (a handle you can\'t drag is a lie)', await waitFor(`import('/lib/world.js').then((m) => !!m.comps.get('benchlamp')?.lock) && globalThis.__gizmo?.().attached === null`), JSON.stringify(await evalJson(`(() => { const g = globalThis.__gizmo?.(); return g && { attached: g.attached }; })()`)));
await sleep(600);
await evalJson(`import('/lib/inspect.js').then((m) => m.commitEdit('benchlamp', 'flags.lock', false)), true`);
check('unlocking re-attaches', await waitFor(`import('/lib/world.js').then((m) => !m.comps.get('benchlamp')?.lock) && globalThis.__gizmo?.().attached === 'benchlamp'`));
await evalJson(`import('/lib/build.js').then((m) => m.setTool('select')), true`);
check('select tool → no gizmo', await waitFor(`globalThis.__gizmo?.().attached === null`));
await evalJson(`import('/lib/build.js').then((m) => m.setTool('move')), true`);
await sleep(600);

console.log('\npick: an armed attach completes on a viewport click, not only a row click; both attach paths undo:');
await sleep(1500);   // verb window
check('crate1 is a root to start', await evalJson(`import('/lib/state.js').then((m) => !m.state.st.entities.crate1?.parent)`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('crate1')), true`);
await evalJson(`(() => { const row = [...${hier}.querySelectorAll('.sp-tree-row')].find((r) => /crate1/.test(r.textContent)); row.dispatchEvent(new MouseEvent('contextmenu', { clientX: 120, clientY: 130, bubbles: true, cancelable: true })); const it = [...document.querySelectorAll('.sp-ctx .sp-ctx-item')].find((i) => /attach/.test(i.textContent)); it.click(); return true; })()`);
check('attach armed on crate1: the hint names the world as a target', await waitFor(`globalThis.__editPanels?.().arming === 'crate1' && /in the world/.test(document.querySelector('#hintbar')?.textContent ?? '')`), JSON.stringify(await evalJson(`({ arming: globalThis.__editPanels?.().arming, hint: document.querySelector('#hintbar')?.textContent })`)));
// a viewport pick = build.js select(id) → sceneSelect(id): the same seam, driven directly
await evalJson(`import('/lib/build.js').then((m) => m.select('benchlamp')), true`);
check('picking benchlamp in the viewport mounts crate1 on it and re-selects crate1', await waitFor(`import('/lib/state.js').then((m) => m.state.st.entities.crate1?.parent?.to === 'benchlamp') && import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'crate1')`), 'parent=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.crate1?.parent)`)) + ' sel=' + JSON.stringify(await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelected())`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
check('…and arming is cleared', await evalJson(`globalThis.__editPanels?.().arming === null`));
await sleep(600);
await evalJson(`import('/lib/build.js').then((m) => m.undo()), true`);
check('undo frees it again (the row-click path now shares this undo)', await waitFor(`import('/lib/state.js').then((m) => !m.state.st.entities.crate1?.parent)`), JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => m.state.st.entities.crate1?.parent)`)));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);

console.log('\nmulti-selection: intersected channels, field-wise writes, one undo:');
await sleep(1500);   // verb window
const copyId = await evalJson(`import('/lib/world.js').then((m) => [...m.entities.keys()].find((k) => /^benchlamp~[0-9a-f]{4}$/.test(k)))`);
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => x.querySelector('.sp-item-label').textContent.includes(${JSON.stringify(copyId)})); r.querySelector('.sp-item-main').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })); return true; })()`);
check('Ctrl-click a second row → 2 selected, primary unchanged', await waitFor(`globalThis.__editPanels?.().selection.length === 2 && globalThis.__editPanels().selection[0] === 'benchlamp'`), JSON.stringify(await evalJson(`globalThis.__editPanels?.().selection`)));
check('the inspector says so and shows only SHARED channels (both lights: brightness, no sockets)', await waitFor(`/2 selected/.test(${insp}.textContent) && [...${insp}.querySelectorAll('.sp-f-num .sp-label')].some((l) => /brightness/.test(l.textContent)) && ![...${insp}.querySelectorAll('.sp-f-num .sp-label')].some((l) => /sockets/.test(l.textContent))`), JSON.stringify(await evalJson(`[...${insp}.querySelectorAll('.sp-f-num .sp-label')].map((l) => l.textContent)`)));
check('the second row is marked multi, the first active', await evalJson(`${hier}.querySelectorAll('.sp-tree-row.multi').length === 1 && ${hier}.querySelectorAll('.sp-tree-row.active').length === 1`));
const before = await evalJson(`import('/lib/state.js').then((m) => [m.state.st.entities.benchlamp.intensity, m.state.st.entities[${JSON.stringify(copyId)}].intensity])`);
await evalJson(`(() => { const i = [...${insp}.querySelectorAll('.sp-f-num')].find((r) => /brightness/.test(r.querySelector('.sp-label').textContent)).querySelector('.sp-num'); i.value = '33'; i.dispatchEvent(new Event('change')); return true; })()`);
check('typing 33 into brightness lands on BOTH lights', await waitFor(`import('/lib/state.js').then((m) => m.state.st.entities.benchlamp.intensity === 33 && m.state.st.entities[${JSON.stringify(copyId)}].intensity === 33)`), 'before=' + JSON.stringify(before) + ' now=' + JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => [m.state.st.entities.benchlamp.intensity, m.state.st.entities[${JSON.stringify(copyId)}].intensity])`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
await sleep(1200);
await evalJson(`import('/lib/build.js').then((m) => m.undo()), true`);
check('ONE undo restores both', await waitFor(`import('/lib/state.js').then((m) => m.state.st.entities.benchlamp.intensity === ${before[0]} && m.state.st.entities[${JSON.stringify(copyId)}].intensity === ${before[1]})`), JSON.stringify(await evalJson(`import('/lib/state.js').then((m) => [m.state.st.entities.benchlamp.intensity, m.state.st.entities[${JSON.stringify(copyId)}].intensity])`)));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
check('after undo + a plain select, the set is back to one', await waitFor(`globalThis.__editPanels?.().selection.length === 1`), 'sel=' + JSON.stringify(await evalJson(`globalThis.__editPanels?.().selection`)));
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => x.querySelector('.sp-item-label').textContent.includes(${JSON.stringify(copyId)})); r.querySelector('.sp-item-main').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })); return true; })()`);
check('Ctrl-click extends again → 2', await waitFor(`globalThis.__editPanels?.().selection.length === 2`), JSON.stringify(await evalJson(`globalThis.__editPanels?.().selection`)));
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => x.querySelector('.sp-item-label').textContent.includes(${JSON.stringify(copyId)})); r.querySelector('.sp-item-main').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true })); return true; })()`);
check('Ctrl-click the extra again drops it → 1 selected', await waitFor(`globalThis.__editPanels?.().selection.length === 1`), 'selection=' + JSON.stringify(await evalJson(`globalThis.__editPanels?.().selection`)) + ' rows=' + JSON.stringify(await evalJson(`[...${hier}.querySelectorAll('.sp-tree-row')].map((r) => r.className.replace('sp-item sp-tree-row', '') + ':' + r.querySelector('.sp-item-label').textContent)`)));
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => x.querySelector('.sp-item-label').textContent.includes(${JSON.stringify(copyId)})); r.querySelector('.sp-item-main').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
check('a plain click collapses to that one thing', await waitFor(`globalThis.__editPanels?.().selection.length === 1 && globalThis.__editPanels().selection[0] === ${JSON.stringify(copyId)}`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);

console.log('\nthe legacy World›Scene section still gets the light editor (adapter):');
await evalJson(`document.querySelector('#sec-scene .head')?.click(), true`);
check('scene section renders the light fields through editorsFor', await waitFor(`!!document.querySelector('#sec-scene [data-fe] .sp-num')`));

console.log('\nref field: pick another entity as a value (look.target):');
// add an empty `look` comp to benchlamp so its ref field appears, then select it
await evalJson(`import('/lib/net.js').then((m) => m.sendVerb('comp', { id: 'benchlamp', type: 'look', data: {} })), true`);
await waitFor(`import('/lib/world.js').then((m) => !!m.comps.get('benchlamp')?.look)`);
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /active.*benchlamp|benchlamp/.test(x.querySelector('.sp-item-label').textContent)); r.querySelector('.sp-item-main').click(); return true; })()`);
check('the look comp gives benchlamp a ref field reading "— pick —"', await waitFor(`(() => { const w = ${insp}; if (!w) return false; const r = [...w.querySelectorAll('.sp-f-ref')].find((x) => x.querySelector('.sp-label')?.textContent === 'target'); return !!r && /pick/.test(r.querySelector('.sp-ref-name').textContent); })()`), 'refs=' + JSON.stringify(await evalJson(`(() => { const w = ${insp}; return w ? [...w.querySelectorAll('.sp-f-ref .sp-ref-name')].map((n) => n.textContent) : 'no inspector'; })()`)));
// click the ref name → arm the pick
await evalJson(`(() => { const w = ${insp}; const r = [...w.querySelectorAll('.sp-f-ref')].find((x) => x.querySelector('.sp-label')?.textContent === 'target'); r.querySelector('.sp-ref-name').click(); return true; })()`);
check('clicking the ref arms the pick (the name says "click a target…" and __editLayout reports it)', await waitFor(`(() => { const w = ${insp}; const r = [...w.querySelectorAll('.sp-f-ref')].find((x) => x.querySelector('.sp-label')?.textContent === 'target'); return !!r && /click a target/.test(r.querySelector('.sp-ref-name').textContent); })()`));
// click the lamp3 row → it becomes the target (a ROW-click completion)
await evalJson(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /lamp3/.test(x.querySelector('.sp-item-label').textContent)); r.querySelector('.sp-item-main').click(); return true; })()`);
check('picking the lamp3 row commits look.target = lamp3', await waitFor(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.look?.target === 'lamp3')`), 'look=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.look)`)) + ' refused=' + JSON.stringify(await evalJson(`window.__refused`)));
check('…and the inspector stayed on benchlamp (re-selected after the pick)', await waitFor(`import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'benchlamp')`));
check('…and the ref field now shows the target id, not "pick"', await waitFor(`(() => { const w = ${insp}; const r = [...w.querySelectorAll('.sp-f-ref')].find((x) => x.querySelector('.sp-label')?.textContent === 'target'); return !!r && /lamp3/.test(r.querySelector('.sp-ref-name').textContent); })()`));
// the ✕ clears it
await evalJson(`(() => { const w = ${insp}; const r = [...w.querySelectorAll('.sp-f-ref')].find((x) => x.querySelector('.sp-label')?.textContent === 'target'); r.querySelector('.sp-ref-clear').click(); return true; })()`);
check('the ✕ clears the reference → look comp gone (its only field emptied)', await waitFor(`import('/lib/world.js').then((m) => !m.comps.get('benchlamp')?.look)`), 'look=' + JSON.stringify(await evalJson(`import('/lib/world.js').then((m) => m.comps.get('benchlamp')?.look)`)));

console.log('\nleaving:');
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);
await sleep(200);
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);   // deselect, then leave
check('leaving undocks: frames are back on the body, workspace chrome hidden', await waitFor(`document.querySelector('[data-frame="hierarchy"]').parentElement === document.body && document.querySelector('[data-frame="inspector"]').parentElement === document.body && document.querySelector('.edit-top').hidden && !document.querySelector('.frame.docked')`));
check('Esc hides the frames', await waitFor(`(() => { const F = [...document.querySelectorAll('.frame.edit')]; return F.length === 2 && F.every((f) => getComputedStyle(f).display === 'none'); })()`));
const errs: string[] = (await evalJson(`window.__errs`)) ?? [];
const mine = errs.filter((e) => /editpanels|editlayout|editschema|panels\.js|inspect\.js|lights\.js|seatedit|scenegraph/.test(e));
check('no page errors from the edit surface', mine.length === 0, mine.slice(0, 3).join(' | '));

console.log(`\n${tally.passed} passed, ${tally.failed} failed`);
if (tally.failed) await die(1, 'editpanels-bench: FAILED');
await cleanup();
process.exit(0);
