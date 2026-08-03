// satchel — YOUR inventory, as opposed to the world's.
//
// The build catalog is the WORLD's palette: it lives in the log, grows by
// `asset` verbs, and belongs to everyone here. The satchel is PERSONAL and
// client-held: it lives in your localStorage, never touches the server, and
// follows you across worlds — save a chair in one world, place it in another
// (if its library path resolves there; cross-host references are what the
// eido: URI draft is for, and this module is its natural first consumer).
//
// That separation is the point (and the ask): personal vs server-side
// inventory as different KINDS of thing, not different folders on the same
// shelf. Nothing here is economy — no ownership transfer, no scarcity. Later,
// maybe. Storage first.

import { report } from './core.js';
import { makeSection, flashHint } from './ui.js';
import { holdGhost } from './build.js';

const KEY = 'ew-satchel';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch (e) { report('satchel read', e); return []; }
}
function save(items) { localStorage.setItem(KEY, JSON.stringify(items)); }

export function satchelAdd(lib, name) {
  if (!lib) return;
  const items = load();
  if (items.some((i) => i.lib === lib)) { flashHint('already in your satchel'); return; }
  items.push({ lib, name: name ?? lib.split('/').pop().replace('.glb', ''), added: Date.now() });
  save(items);
  flashHint(`🎒 <b>${items[items.length - 1].name}</b> saved to your satchel`);
  paint();
}

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let body = null;
function paint() {
  if (!body) return;
  const items = load();
  body.innerHTML = items.length
    ? `<div style="color:var(--dim);font-size:10px;margin-bottom:3px">yours — lives in this browser, follows you between worlds</div>
       ${items.map((i, n) => `<div class="who-row" style="cursor:pointer" data-n="${n}">
         <span class="n">🎒 ${esc(i.name)}</span>
         <span class="d"><button data-del="${n}" style="font-size:10px">✕</button></span></div>`).join('')}`
    : '<div style="color:var(--dim)">empty — select something in the 🌳 scene and hit 🎒 save</div>';
  for (const row of body.querySelectorAll('[data-n]')) {
    row.onclick = (e) => {
      if (e.target.dataset.del != null) return;
      const it = load()[+row.dataset.n];
      if (it) holdGhost(it.lib, it.name);
    };
  }
  for (const del of body.querySelectorAll('[data-del]')) {
    del.onclick = () => { const items2 = load(); items2.splice(+del.dataset.del, 1); save(items2); paint(); };
  }
}

export function initSatchel() {
  makeSection('🎒 satchel', (b) => { body = b; paint(); }, { id: 'satchel' });
}
