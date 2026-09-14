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
check('B shows both', await waitFor(`[...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display !== 'none')`));
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
check('R → rotate tool (Blender)', await evalJson(`globalThis.__editLayout?.().tool === 'rotate'`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true })), true`);
check('G → move tool', await evalJson(`globalThis.__editLayout?.().tool === 'move'`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })), true`);
check('W is still walking — no tool change', await evalJson(`globalThis.__editLayout?.().tool === 'move'`));
check('tool buttons show their letters', await evalJson(`[...document.querySelectorAll('.edit-tool-key')].map((k) => k.textContent).join('') === 'QGRS'`));
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
  check('Esc restores the face', await evalJson(`${inp}.value === '10'`), await evalJson(`${inp}.value`));
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
check('a mounted light indents under its carrier', await waitFor(`(() => { const R = [...${hier}.querySelectorAll('.sp-tree-row')]; const r = R.find((x) => /lamp3/.test(x.querySelector('.sp-item-label').textContent)); return !!r && parseInt(r.style.paddingLeft) > 10; })()`));
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
check('…and the keystroke never reached the walking keys', !(await evalJson(`window.__keys.includes('ArrowDown')`)), 'keys=' + JSON.stringify(await evalJson(`window.__keys.slice(-5)`)));
await evalJson(`(() => { const s = ${hier}.querySelector('.schema-scroll'); s.focus(); s.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true, cancelable: true })); return true; })()`);
check('↑ selects the previous', await waitFor(`import('/lib/scenegraph.js').then((m) => m.sceneSelected() === 'benchlamp')`));
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', shiftKey: true, bubbles: true })), true`);
check('Shift+D duplicates: a new light carrying the SOURCE\'s components (minus lock), nudged', await waitFor(`import('/lib/world.js').then((m) => { const id = [...m.entities.keys()].find((k) => /^benchlamp-[0-9a-f]{4}$/.test(k)); const o = m.entities.get(id); if (!o) return false; const strip = (b) => { const c = { ...(b ?? {}) }; delete c.lock; return JSON.stringify(c); }; return strip(m.comps.get(id)) === strip(m.comps.get('benchlamp')) && Math.abs(o.position.x - 1.5) < 0.01; })`), await evalJson(`import('/lib/world.js').then((m) => { const id = [...m.entities.keys()].find((k) => /^benchlamp-[0-9a-f]{4}$/.test(k)); return JSON.stringify({ id, comps: m.comps.get(id), src: m.comps.get('benchlamp'), pos: m.entities.get(id)?.position.toArray() }); })`));
check('…and the copy is selected', await waitFor(`import('/lib/scenegraph.js').then((m) => /^benchlamp-[0-9a-f]{4}$/.test(m.sceneSelected() ?? ''))`));
await evalJson(`import('/lib/scenegraph.js').then((m) => m.sceneSelect('benchlamp')), true`);
await waitFor(`${insp}.querySelector('.sp-info')?.textContent.startsWith('benchlamp')`);

console.log('\nthe legacy World›Scene section still gets the light editor (adapter):');
await evalJson(`document.querySelector('#sec-scene .head')?.click(), true`);
check('scene section renders the light fields through editorsFor', await waitFor(`!!document.querySelector('#sec-scene [data-fe] .sp-num')`));

console.log('\nleaving:');
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);
await sleep(200);
await evalJson(`dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })), true`);   // deselect, then leave
check('leaving undocks: frames are back on the body, workspace chrome hidden', await waitFor(`document.querySelector('[data-frame="hierarchy"]').parentElement === document.body && document.querySelector('[data-frame="inspector"]').parentElement === document.body && document.querySelector('.edit-top').hidden && !document.querySelector('.frame.docked')`));
check('Esc hides the frames', await waitFor(`[...document.querySelectorAll('.frame.edit')].every((f) => getComputedStyle(f).display === 'none')`));
const errs: string[] = (await evalJson(`window.__errs`)) ?? [];
const mine = errs.filter((e) => /editpanels|panels\.js|inspect\.js|lights\.js|scenegraph/.test(e));
check('no page errors from the edit surface', mine.length === 0, mine.slice(0, 3).join(' | '));

console.log(`\n${tally.passed} passed, ${tally.failed} failed`);
if (tally.failed) await die(1, 'editpanels-bench: FAILED');
await cleanup();
process.exit(0);
