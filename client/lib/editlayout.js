// editlayout — edit mode as a WORKSPACE (Blender's word): the same frames,
// a different arrangement. Nothing is replaced; frames are docked into
// columns while the mode is on and float again exactly where they were
// when it ends. The shape is the one every shipping editor converged on:
//
//   ∃ ─┬─ top strip: menus, undo, the tool's name ────────────────────
//   🔧 │ Hierarchy   │                              │ Inspector
//   🎧 │ ───split─── │          viewport            │
//   🎤 │ Chat        │                              │
//   ↖✥↻⤢ tools     └──────────────────────────────┘
//
// Chat stays: every edit is a logged sentence, so the chat pane is the edit
// history with the people (and agents) in it. The rail slims to ∃ / wrench /
// mic / ear / goggles by CSS (index.html body.edit-mode #dock); every other
// window is one Panels ▾ click away, never gone.

import { bus } from './base.js';
import { getFrame, allFrames } from './frames.js';
import { setTool, getTool, undo, deselect, setEditMode } from './build.js';
import { panelFrame } from './ui.js';
import { THREE, scene } from './core.js';

const LS = 'ew-edit-layout';
const DEF = { leftW: 300, rightW: 320, leftSplit: 0.55 };
let L = { ...DEF };
try { L = { ...DEF, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { /* defaults */ }
const save = () => { try { localStorage.setItem(LS, JSON.stringify(L)); } catch { /* fine */ } };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const TOOLS = [   // every letter off the walking set: WASD walks here (Maya's W and Blender's S both collide)
  { id: 'select', glyph: '↖', key: 'Q', title: 'select (Q) — click picks, a drag never moves' },
  { id: 'move', glyph: '✥', key: 'G', title: 'move (G) — drag moves; Shift+drag raises' },
  { id: 'rotate', glyph: '↻', key: 'E', title: 'rotate (E) — drag turns about up' },
  { id: 'scale', glyph: '⤢', key: 'R', title: 'scale (R) — drag sizes, uniform' },
  { id: 'pivot', glyph: '⊙', key: '', title: 'pivot — later, with rot/scale[] in the protocol', disabled: true },
];

let els = null;          // { top, tools, left, right, split, lsplit, rsplit }
let prevChat = null;     // chat's visibility before docking, restored on exit
let prevWorld = null;    // the World panel's, likewise
let on = false;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function build() {
  if (els) return els;
  const top = el('div', 'edit-strip edit-top');
  const tools = el('div', 'edit-strip edit-tools');
  const left = el('div', 'edit-col edit-left');
  const right = el('div', 'edit-col edit-right');
  const lsplit = el('div', 'edit-split edit-split-v');    // left column's right edge
  const rsplit = el('div', 'edit-split edit-split-v');    // right column's left edge
  const split = el('div', 'edit-split edit-split-h');     // between hierarchy and chat
  left.append(split);
  for (const e of [top, tools, left, right, lsplit, rsplit]) { e.hidden = true; document.body.append(e); }

  // ---- tools column
  for (const t of TOOLS) {
    const b = el('button', 'edit-tool', t.glyph);
    if (t.key) b.append(el('kbd', 'edit-tool-key', t.key));   // the letter, so hands learn it
    b.dataset.tool = t.id; b.title = t.title; b.disabled = !!t.disabled;
    b.onclick = () => setTool(t.id);
    tools.append(b);
  }
  bus.on('tool', paintTools);

  // ---- top strip: menus, undo, mode
  const menus = el('div', 'edit-menus');
  menus.append(
    menu('World', () => [
      { label: 'world panel (ground · sky · build)…', run: () => { const w = panelFrame(); w.show(); w.el.style.zIndex = '30'; } },
    ]),
    menu('Edit', () => [
      { label: 'undo\tCtrl+Z', run: undo },
      { label: 'deselect\tEsc', run: deselect },
      { label: 'leave edit mode', run: () => setEditMode(false) },
    ]),
    menu('View', () => [
      { label: 'reset workspace layout', run: () => { L = { ...DEF }; save(); apply(); } },
      { label: `${getFrame('chat')?.visible ? 'hide' : 'show'} chat`, run: () => { getFrame('chat')?.toggle(); apply(); } },
    ]),
    menu('Panels', () => allFrames().filter((f) => !f.docked).map((f) => ({
      label: `${f.visible ? '● ' : '○ '}${f.id}`, run: () => f.toggle(),
    }))),
  );
  const undoBtn = el('button', 'edit-btn', '↶ undo'); undoBtn.title = 'Ctrl+Z'; undoBtn.onclick = undo;
  // viewport buttons: what the render does, not what the world is
  const view = el('div', 'edit-viewbtns');
  const wire = el('button', 'edit-vbtn', '▦'); wire.title = 'wireframe'; wire.dataset.view = 'wire';
  wire.onclick = () => { setWireframe(!wireOn); wire.classList.toggle('on', wireOn); };
  const full = el('button', 'edit-vbtn', '⛶'); full.title = 'full screen (F11 also works)'; full.dataset.view = 'full';
  full.onclick = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.(); };
  document.addEventListener('fullscreenchange', () => full.classList.toggle('on', !!document.fullscreenElement));
  view.append(wire, full);
  const mode = el('span', 'edit-mode-label');
  const seat = el('span', 'edit-seat');   // mic / ear / goggles are re-seated here by CSS (they are fixed elements owned by their modules)
  top.append(menus, undoBtn, view, mode, seat);
  bus.on('tool', () => { mode.textContent = getTool(); });
  mode.textContent = getTool();

  // ---- splitters
  dragSplit(lsplit, (dx) => { L.leftW = clamp(L.leftW + dx, 200, innerWidth * 0.45); });
  dragSplit(rsplit, (dx) => { L.rightW = clamp(L.rightW - dx, 220, innerWidth * 0.45); });
  dragSplit(split, (_dx, dy) => { L.leftSplit = clamp(L.leftSplit + dy / left.clientHeight, 0.15, 0.85); });
  addEventListener('resize', () => { if (on) apply(); });

  els = { top, tools, left, right, split, lsplit, rsplit };
  paintTools();
  return els;
}

// wireframe = one override material on the scene; the renderer draws every
// mesh with it and nothing in the world is touched. Off on exit.
let wireOn = false;
let wireMat = null;
function setWireframe(v) {
  wireOn = !!v;
  if (wireOn) {
    wireMat ??= new THREE.MeshBasicNodeMaterial({ color: 0xbfc4cc, wireframe: true, toneMapped: false });
    scene.overrideMaterial = wireMat;
  } else if (scene.overrideMaterial === wireMat) scene.overrideMaterial = null;
}

function menu(label, items) {
  const wrap = el('span', 'edit-menu');
  const b = el('button', 'edit-btn', `${label} ▾`);
  const pop = el('div', 'edit-menu-pop'); pop.hidden = true;
  b.onclick = (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    closeMenus();
    if (!open) return;
    pop.innerHTML = '';
    for (const it of items()) {
      const row = el('button', 'edit-menu-item');
      const [txt, key] = it.label.split('\t');
      row.append(el('span', '', txt)); if (key) row.append(el('kbd', '', key));
      row.onclick = () => { closeMenus(); it.run(); };
      pop.append(row);
    }
    pop.hidden = false;
  };
  wrap.append(b, pop);
  return wrap;
}
function closeMenus() { for (const p of document.querySelectorAll('.edit-menu-pop')) p.hidden = true; }
addEventListener('pointerdown', (e) => { if (!(e.target instanceof Element && e.target.closest('.edit-menu'))) closeMenus(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); }, true);

function dragSplit(handle, onDelta) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    let lx = e.clientX, ly = e.clientY;
    try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const move = (ev) => { onDelta(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; apply(); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); save(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

function paintTools() {
  if (!els) return;
  for (const b of els.tools.querySelectorAll('.edit-tool')) b.classList.toggle('on', b.dataset.tool === getTool());
}

/** Lay the columns out from L; called on enter, on every splitter move, on resize. */
function apply() {
  if (!els || !on) return;
  const { top, tools, left, right, split, lsplit, rsplit } = els;
  const TOP = 40, RAIL = 48;
  // the rail is a full-height neutral BAND: mic/ear stack above the ∃ inside
  // it (the dock is pushed down so placeMic finds room), the wrench below,
  // then the tools. The strip starts at the band's edge — no gaps (R, 09-13).
  top.style.cssText = `left:${RAIL}px; right:0; top:0; height:${TOP}px`;
  tools.style.cssText = `left:0; top:0; bottom:0; width:${RAIL}px; padding-top:${TOP + 52}px`;
  const leftW = Math.round(L.leftW), rightW = Math.round(L.rightW);
  left.style.cssText = `left:${RAIL}px; top:${TOP}px; bottom:0; width:${leftW}px`;
  right.style.cssText = `right:0; top:${TOP}px; bottom:0; width:${rightW}px`;
  lsplit.style.cssText = `left:${RAIL + leftW - 3}px; top:${TOP}px; bottom:0`;
  rsplit.style.cssText = `right:${rightW - 3}px; top:${TOP}px; bottom:0`;
  // fixed chrome that predates the columns (structure bar, toasts, hint bar)
  // reads the viewport's edges from these instead of the window's
  document.body.style.setProperty('--edit-left-edge', `${RAIL + leftW}px`);
  document.body.style.setProperty('--edit-right-w', `${rightW}px`);
  const chat = getFrame('chat');
  const chatOn = !!chat?.visible;
  const h = getFrame('hierarchy');
  // hierarchy takes leftSplit of the column when chat shows, all of it otherwise
  const hh = chatOn ? Math.round(left.clientHeight * L.leftSplit) : left.clientHeight;
  if (h) h.el.style.flex = `0 0 ${hh}px`;
  split.hidden = !chatOn;
  if (chat) chat.el.style.flex = '1 1 0';
}

function enter() {
  const { top, tools, left, right, lsplit, rsplit } = build();
  on = true;
  for (const e of [top, tools, left, right, lsplit, rsplit]) e.hidden = false;
  document.body.classList.add('edit-workspace');
  const h = getFrame('hierarchy'), i = getFrame('inspector'), c = getFrame('chat');
  h?.dock(left); left.prepend(h.el);            // hierarchy above the splitter
  i?.dock(right);
  if (c) { prevChat = c.visible; c.dock(left); if (!c.visible) c.show(); }
  // floating frames render UNDER the columns; the World panel build.js opens
  // on entry sits at the right edge, exactly where the Inspector now is.
  // Park it; World ▾ brings it back, and exit restores it.
  const w = getFrame('world');
  prevWorld = !!w?.visible;
  if (w?.visible) w.hide();
  apply();
}
function exit() {
  if (!els || !on) return;
  on = false;
  const { top, tools, left, right, lsplit, rsplit } = els;
  for (const e of [top, tools, left, right, lsplit, rsplit]) e.hidden = true;
  document.body.classList.remove('edit-workspace');
  setWireframe(false);
  if (els.top.querySelector('.edit-vbtn[data-view="wire"]')) els.top.querySelector('.edit-vbtn[data-view="wire"]').classList.remove('on');
  const c = getFrame('chat');
  for (const f of [getFrame('hierarchy'), getFrame('inspector'), c]) { if (f) { f.el.style.flex = ''; f.undock(); } }
  if (c && prevChat != null) c[prevChat ? 'show' : 'hide']();   // exactly as it was before the workspace
  if (prevWorld) getFrame('world')?.show();
  prevChat = prevWorld = null;
  closeMenus();
}

export function initEditLayout() {
  bus.on('edit-mode', (v) => (v ? enter() : exit()));
  // tool hotkeys live in build.js's key router (Blender's G/R/S/Q/F/X)
  return { apply, isOn: () => on };
}

/** harness window */
export const editLayoutDebug = () => ({ on, layout: { ...L }, tool: getTool(),
  docked: allFrames().filter((f) => f.docked).map((f) => f.id) });
