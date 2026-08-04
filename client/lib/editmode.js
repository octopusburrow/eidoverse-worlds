// editmode — the full edit surface. Slice 1 of notes/design-scene-edit-surface.md.
//
// An ADDITIVE projection of the same state the 🌳 scene section shows: hierarchy
// docked left, inspector docked right, the world visible between them, and a
// verb-echo line along the bottom showing the exact log entry each action speaks.
// The echo line is the curriculum: click a field, watch the sentence it becomes.
// Everything here READS client state and EMITS verbs — same contract as the panel;
// the section and this surface share one selection (sg:select) and never fork.
//
// Off = nothing exists (display:none, zero cost). Esc or ⛶ closes.

import { THREE, bus, camera, canvas } from './core.js';
import { entities, entityMeta, comps } from './world.js';
import {
  treeData, badgesFor, channelBox, wireChannelBox, sgSelected, sgSelect,
} from './scenegraph.js';

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PANE = 'position:fixed;top:8px;bottom:34px;width:250px;z-index:40;' +
  'background:rgba(4,14,20,.92);border:1px solid var(--edge);border-radius:8px;' +
  'color:var(--fg);font-size:12px;display:flex;flex-direction:column;overflow:hidden;';

let root = null;         // container for all three regions
let hier = null, insp = null, echo = null;
let open = false;
let echoLog = [];        // last few spoken verbs, newest last

function build() {
  root = document.createElement('div');
  root.id = 'editmode';
  root.style.display = 'none';
  root.innerHTML = `
    <div class="em-hier" style="${PANE}left:8px">
      <div style="padding:6px 8px;border-bottom:1px solid var(--edge);display:flex;justify-content:space-between;align-items:center">
        <b>hierarchy</b><button class="em-close" title="close (Esc)">⛶</button></div>
      <div class="em-tree" style="flex:1;overflow:auto;padding:4px"></div>
    </div>
    <div class="em-insp" style="${PANE}right:8px;width:270px">
      <div style="padding:6px 8px;border-bottom:1px solid var(--edge)"><b>inspector</b></div>
      <div class="em-body" style="flex:1;overflow:auto;padding:6px 8px"></div>
    </div>
    <div class="em-echo" style="position:fixed;left:8px;right:8px;bottom:6px;z-index:40;
      background:rgba(4,14,20,.92);border:1px solid var(--edge);border-radius:6px;
      padding:3px 8px;font:11px monospace;color:var(--dim);white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis" title="every edit is a verb in the world log — this is the sentence you just spoke"></div>`;
  document.body.appendChild(root);
  hier = root.querySelector('.em-tree');
  insp = root.querySelector('.em-body');
  echo = root.querySelector('.em-echo');
  root.querySelector('.em-close').onclick = () => toggle(false);
}

// ---- hierarchy: entities, mounted children, riders, and declared sockets ---
function paintHier() {
  const { roots, kids, riders } = treeData();
  const sel = sgSelected();
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
    el.onclick = () => sgSelect(el.dataset.id === sgSelected() ? null : el.dataset.id);
  }
}

// ---- inspector: reuses the section's channel box verbatim ------------------
function paintInsp() {
  const sel = sgSelected();
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

export function initEditMode() {
  bus.on('editmode:toggle', () => toggle());
  canvas.addEventListener('click', (ev) => {
    if (!open || document.pointerLockElement) return;
    const id = pickAt(ev);
    if (id) sgSelect(id === sgSelected() ? null : id);
  });
  bus.on('sg:select', repaintAll);
  bus.on('entity', queueRepaint);
  bus.on('comp', queueRepaint);
  bus.on('mount', queueRepaint);
  bus.on('verb:sent', (v) => { if (open) paintEcho(v); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) toggle(false);
  });
}
