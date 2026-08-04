// workshop.js — OUR edit mode, whole and self-contained. (R's ruling, in-world
// 15:00: the lab is in heavy architecture mode — we leave their edit surfaces
// completely alone and grow our own, reading the same world state. "Another
// panel reading all the same information." When their architecture settles,
// world capabilities can migrate INTO here deliberately, not by entanglement.)
//
// Imports are STOCK modules only (world state, net verbs, core bus) plus our
// own editundo.js. Nothing here patches their files; the Edit button injects
// itself into the dock at the DOM level and can be deleted with this file.
//
// Everything READS client state and EMITS verbs — identical contract to their
// scene panel: a human typing 90 into yaw and an agent speaking `place`
// produce identical log entries. One selection, kept local ('ws:select').

import { THREE, bus, camera, canvas } from './core.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb as netSendVerb } from './net.js';
import { componentTypes, componentSpec, defaultsFor } from './components.js';
import { recordPair } from './editundo.js';
import { flashHint } from './ui.js';

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// local verb wrapper: the echo line sees what WE speak, no hook in net.js
let onSpoke = null;
const sendVerb = (verb, args) => { netSendVerb(verb, args); onSpoke?.({ verb, args }); };

// ---- selection (ours, local) ----------------------------------------------
let selected = null;
function wsSelect(id) { selected = id; bus.emit('ws:select', id); }

function badgesFor(id) {
  const out = [];
  const bag = comps.get(id) ?? {};
  for (const [type, data] of Object.entries(bag)) {
    if (type === 'motion' || type.startsWith('motion:')) {
      out.push(`${type}(${data?.type ?? '…'})`);
    } else if (type === 'sockets' || type === 'reactions') {
      out.push(`${type}(${Object.keys(data ?? {}).join(',')})`);
    } else out.push(type);
  }
  return out;
}
function treeData() {
  const kids = new Map();
  const roots = [];
  for (const [id, obj] of entities) {
    const p = obj?.userData?.mountedTo;
    if (p && entities.has(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(id);
    } else roots.push(id);
  }
  const riders = new Map();
  for (const [rid, m] of avatarMounts) {
    if (!riders.has(m.to)) riders.set(m.to, []);
    riders.get(m.to).push(m.slot ? `${rid} (${m.slot})` : rid);
  }
  return { roots, kids, riders };
}

// ---- channel box -----------------------------------------------------------
// The inspector used to show the component bag as read-only JSON — you could
// SEE a slot's data but the only way to change it was chat or an agent. These
// are the same editable channels an animator expects (transform first, then
// every component), and every commit is an ordinary verb: a human typing 90
// into "yaw" and an agent speaking `place` produce identical log entries.
// Yaw is shown in DEGREES (the log speaks radians) — humans think in degrees.
const DEG = 180 / Math.PI;
// house input style — the panel's own palette, not browser-default white
const IN = 'width:100%;box-sizing:border-box;background:rgba(4,14,20,.9);color:var(--fg);border:1px solid var(--edge);border-radius:4px;padding:2px 6px;font:11px inherit';
const num = (v, step = 0.1) =>
  `<input type="number" step="${step}" value="${Number.isFinite(v) ? +v.toFixed(3) : 0}" style="${IN}">`;
// a channel ROW: label column + value column, grid-aligned — an animator is
// reading this panel, and unaligned translate channels are a war crime
const GRID = 'display:grid;grid-template-columns:52px minmax(0,96px);gap:3px 6px;align-items:center;font-size:11px';

function channelBox(id, bag, obj) {
  const rows = [];
  if (obj) {
    rows.push(`<div class="cb-sec" style="color:var(--dim);margin-top:4px">transform</div>
      <div class="cb-xf" style="${GRID}">
        <span>pos X</span>${num(obj.position.x)}
        <span>pos Y</span>${num(obj.position.y)}
        <span>pos Z</span>${num(obj.position.z)}
        <span>yaw°</span>${num(obj.rotation.y * DEG, 5)}
        <span>scale</span>${num(obj.scale.x, 0.05)}
      </div>`);
  }
  for (const [type, data] of Object.entries(bag ?? {})) {
    rows.push(`<div class="cb-sec" style="display:flex;justify-content:space-between;color:var(--dim);margin-top:4px">
      <span>${esc(type)}</span><button data-cb-del="${esc(type)}" title="remove component" style="font-size:10px">✕</button></div>`);
    const custom = componentSpec(type)?.editor?.(id, data, { esc, num, GRID }) ?? '';
    if (custom) { rows.push(`<div data-cb-custom="${esc(type)}">${custom}</div>`); continue; }
    const flat = data && typeof data === 'object' && !Array.isArray(data)
      && Object.values(data).every((v) => ['number', 'string', 'boolean'].includes(typeof v)
        || (Array.isArray(v) && v.length <= 4 && v.every((n) => typeof n === 'number')));
    if (flat) {
      const fields = Object.entries(data).map(([k, v]) => {
        const lab = `<span style="overflow:hidden;text-overflow:ellipsis">${esc(k)}</span>`;
        if (typeof v === 'number') return `<label data-cb="${esc(type)}" data-k="${esc(k)}" style="display:contents">${lab}${num(v)}</label>`;
        if (typeof v === 'boolean') return `<label data-cb="${esc(type)}" data-k="${esc(k)}" style="display:contents">${lab}<input type="checkbox" ${v ? 'checked' : ''} style="justify-self:start"></label>`;
        if (Array.isArray(v)) return `<label data-cb="${esc(type)}" data-k="${esc(k)}" data-arr="1" style="display:contents">${lab}<span style="display:flex;gap:3px">${v.map((n) => num(n)).join('')}</span></label>`;
        return `<label data-cb="${esc(type)}" data-k="${esc(k)}" style="display:contents">${lab}<input type="text" value="${esc(v)}" style="${IN}"></label>`;
      });
      rows.push(`<div style="${GRID}">${fields.join('')}</div>`);
    } else {
      rows.push(`<textarea data-cb-json="${esc(type)}" spellcheck="false"
        style="width:100%;min-height:52px;font:10px monospace;background:rgba(4,14,20,.9);color:var(--fg);border:1px solid var(--edge)">${esc(JSON.stringify(data, null, 1))}</textarea>`);
    }
  }
  const opts = componentTypes().map((t) => {
    const h = componentSpec(t)?.hint;
    return `<option value="${esc(t)}">${h ? esc(h) : ''}</option>`;
  }).join('');
  rows.push(`<div style="display:flex;gap:4px;margin-top:4px;font-size:11px">
    <input class="cb-add-type" list="cb-types" placeholder="add component…" style="width:130px">
    <datalist id="cb-types">${opts}</datalist>
    <button class="cb-add">+</button></div>`);
  return `<div class="cb" style="max-height:210px;overflow:auto;margin:4px 0">${rows.join('')}</div>`;
}

function wireChannelBox(id, root) {
  const cb = root.querySelector('.cb');
  if (!cb) return;
  const commitComp = (type, data) => {
    const prev = structuredClone(comps.get(id)?.[type] ?? null);
    recordPair({ verb: 'comp', args: { id, type, data: prev } },
               { verb: 'comp', args: { id, type, data } });
    sendVerb('comp', { id, type, data });
  };

  const xf = cb.querySelector('.cb-xf');
  if (xf) {
    const [x, y, z, yawDeg, scale] = [...xf.querySelectorAll('input')];
    const commitXf = () => {
      const obj = entities.get(id);
      if (obj) recordPair(
        { verb: 'place', args: { id, pos: [+obj.position.x.toFixed(3), +obj.position.y.toFixed(3), +obj.position.z.toFixed(3)], yaw: +obj.rotation.y.toFixed(4), scale: +obj.scale.x.toFixed(3) } },
        { verb: 'place', args: { id, pos: [+x.value || 0, +y.value || 0, +z.value || 0], yaw: (+yawDeg.value || 0) / DEG, scale: +scale.value || 1 } });
      sendVerb('place', {
        id,
        pos: [+x.value || 0, +y.value || 0, +z.value || 0],
        yaw: (+yawDeg.value || 0) / DEG,
        scale: +scale.value || 1,
      });
    };
    for (const el of [x, y, z, yawDeg, scale]) el.addEventListener('change', commitXf);
  }
  for (const lab of cb.querySelectorAll('label[data-cb]')) {
    lab.addEventListener('change', () => {
      const type = lab.dataset.cb, k = lab.dataset.k;
      const data = structuredClone(comps.get(id)?.[type] ?? {});
      const ins = [...lab.querySelectorAll('input')];
      if (lab.dataset.arr) data[k] = ins.map((i) => +i.value || 0);
      else if (ins[0].type === 'checkbox') data[k] = ins[0].checked;
      else if (ins[0].type === 'number') data[k] = +ins[0].value || 0;
      else data[k] = ins[0].value;
      commitComp(type, data);
    });
  }
  for (const ta of cb.querySelectorAll('textarea[data-cb-json]')) {
    ta.addEventListener('change', () => {
      try { commitComp(ta.dataset.cbJson, JSON.parse(ta.value)); ta.style.borderColor = ''; }
      catch { ta.style.borderColor = '#c33'; flashHint('not valid JSON — component unchanged'); }
    });
  }
  for (const del of cb.querySelectorAll('[data-cb-del]')) {
    del.addEventListener('click', () => commitComp(del.dataset.cbDel, null));
  }
  cb.querySelector('.cb-add')?.addEventListener('click', () => {
    const type = cb.querySelector('.cb-add-type')?.value.trim();
    if (type) commitComp(type, defaultsFor(type));
  });
  for (const box of cb.querySelectorAll('[data-cb-custom]')) {
    const type = box.dataset.cbCustom;
    componentSpec(type)?.wire?.(box, id, (data) => commitComp(type, data));
  }
}
// ---- hierarchy: entities, mounted children, riders, and declared sockets ---
function paintHier() {
  const { roots, kids, riders } = treeData();
  const sel = selected;
  const rows = [];
  const row = (id, depth) => {
    const meta = entityMeta.get(id);
    const short = (meta?.lib ?? '?').split('/').pop().replace('.glb', '');
    rows.push(`<div class="em-row" data-id="${esc(id)}" style="cursor:pointer;padding:1px 4px 1px ${4 + depth * 14}px;border-radius:4px;${id === sel ? 'background:rgba(255,255,255,.08)' : ''}">
      ${depth ? '└ ' : ''}<b>${esc(id)}</b> <span style="color:var(--dim)">${esc(short)}</span></div>`);
    const socks = comps.get(id)?.sockets ?? {};
    for (const slot of Object.keys(socks)) {
      rows.push(`<div style="padding-left:${18 + depth * 14}px;color:var(--dim)">◦ ${esc(slot)} <span style="font-size:10px">socket</span></div>`);
    }
    for (const r of riders.get(id) ?? []) {
      rows.push(`<div style="padding-left:${18 + depth * 14}px;color:var(--dim)">🧍 ${esc(r)}</div>`);
    }
    for (const k of kids.get(id) ?? []) row(k, depth + 1);
  };
  for (const id of roots.sort()) row(id, 0);
  hier.innerHTML = rows.join('') || '<div style="color:var(--dim);padding:4px">nothing placed yet</div>';
  for (const el of hier.querySelectorAll('.em-row')) {
    el.onclick = () => wsSelect(el.dataset.id === selected ? null : el.dataset.id);
  }
}

// ---- inspector: reuses the section's channel box verbatim ------------------
function paintInsp() {
  const sel = selected;
  if (!sel || !entities.has(sel)) {
    insp.innerHTML = '<div style="color:var(--dim)">select something in the hierarchy<br>— or click it in the world</div>';
    return;
  }
  const meta = entityMeta.get(sel);
  const bag = comps.get(sel);
  const obj = entities.get(sel);
  insp.innerHTML = `<div><b>${esc(sel)}</b></div>
    <div style="color:var(--dim);font-size:11px;margin-bottom:2px">${esc(meta?.lib ?? '')}${meta?.actor ? ` · placed by ${esc(meta.actor)}` : ''}</div>
    ${channelBox(sel, bag, obj)}`;
  const cb = insp.querySelector('.cb');
  if (cb) cb.style.maxHeight = 'none';       // the dock has room the section lacks
  // the section's 96px value column starves 3-wide array fields; the dock has width
  for (const g of insp.querySelectorAll('[style*="grid-template-columns"]')) {
    g.style.gridTemplateColumns = '64px minmax(0,1fr)';
  }
  wireChannelBox(sel, insp);
}

// ---- verb echo -------------------------------------------------------------
function paintEcho({ verb, args } = {}) {
  if (verb) {
    echoLog.push(`${verb} ${JSON.stringify(args)}`);
    if (echoLog.length > 3) echoLog.shift();
  }
  echo.innerHTML = echoLog.length
    ? echoLog.map((l, i) => `<span style="${i === echoLog.length - 1 ? 'color:var(--fg)' : ''}">${esc(l)}</span>`).join('  ·  ')
    : 'every edit speaks a verb into the world log — your sentences will appear here';
}

// ---- lifecycle -------------------------------------------------------------
const repaintAll = () => { if (open) { paintHier(); paintInsp(); } };
let queued = false;
function queueRepaint() {
  if (!open || queued) return;
  const a = document.activeElement;   // never repaint under someone's mid-edit
  if (a && insp?.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
  queued = true;
  setTimeout(() => { queued = false; repaintAll(); }, 300);
}

export function toggle(force) {
  open = force ?? !open;
  if (!root) build();
  root.style.display = open ? '' : 'none';
  if (open) { repaintAll(); paintEcho(); }
}

// click-to-select in the viewport while the surface is open: the same act as
// clicking a hierarchy row, resolved by ray instead of by list.
const _selRay = new THREE.Raycaster();
function pickAt(ev) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  _selRay.setFromCamera(p, camera);
  const roots = [...entities.values()].filter(Boolean);
  const hit = _selRay.intersectObjects(roots, true)[0];
  let n = hit?.object;
  while (n && !n.userData.entityId) n = n.parent;
  return n?.userData.entityId ?? null;
}

export function initWorkshop() {
  
  canvas.addEventListener('click', (ev) => {
    if (!open || document.pointerLockElement) return;
    const id = pickAt(ev);
    if (id) wsSelect(id === selected ? null : id);
  });
  bus.on('ws:select', repaintAll);
  bus.on('entity', queueRepaint);
  bus.on('comp', queueRepaint);
  bus.on('mount', queueRepaint);
  onSpoke = (v) => { if (open) paintEcho(v); };   // our own verbs, no net.js hook
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) toggle(false);
  });
}

// ---- the Edit button: self-injected, self-removing --------------------------
// DOM-level graft onto the dock — zero changes in ui.js. If the dock isn't
// built yet we wait a tick; if it never appears, the button simply doesn't.
// initDock() rebuilds the dock's innerHTML whenever it repaints, erasing any
// graft — so the graft is a tenant, not a squatter: check the lease every
// second, move back in when the landlord renovates. Still zero ui.js changes.
let wsButton = null;
function ensureButton() {
  const dock = document.querySelector('#dock');
  if (!dock || dock.contains(wsButton)) return;
  wsButton = document.createElement('button');
  wsButton.textContent = '✏️ Edit';
  wsButton.title = 'workshop — our edit mode (Esc closes)';
  wsButton.onclick = () => { toggle(); wsButton.classList.toggle('on', open); };
  dock.appendChild(wsButton);
}
setInterval(ensureButton, 1000);
ensureButton();
