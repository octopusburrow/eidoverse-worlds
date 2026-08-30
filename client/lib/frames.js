// frames — movable, resizable, collapsible windows with a remembered layout.
//
// In a 3D client the scene IS the content, so where the chrome sits is a
// personal and per-task decision: someone building wants the catalog big and
// the chat small, someone performing wants the opposite, someone spectating
// wants almost nothing. A fixed rail can't serve all three.
//
// The model is the one MMO players already have in their hands: drag a frame
// by its title, drag its corner to resize, collapse it to a title bar, lock
// the whole layout when you're happy, and have it still be there tomorrow.

import { bus } from './core.js';

const LS = (id) => `ew-frame-${id}`;
const frames = new Map();

// ---- edge-resize: one document-level hit-tester for all frames -------------
// Grab band: 3px inside the border + 7px of free air outside it. Inside
// pixels belong to content — scrollbars and buttons always win (we test the
// real element under the pointer, not geometry alone).
const _resizables = [];
const _BAND = 4, _REACH = 6;   // band R-tuned 17:23 at 2, widened to 4 after
                               // antra's live receipt (edge target was ~8px
                               // total and half of that hung in the air)
const _CORNER = 15;            // the corner is the hardest 2D target on the
                               // frame and USED to be the intersection of two
                               // 2px bands — invisible in practice. It gets
                               // its own square, sized like the old SE grip.
/** Would the edge-resize hit-tester claim this point? (for ui.js's
 *  arrange-exit guard — the grab band extends _REACH px OUTSIDE frames) */
export function resizeZoneAt(x, y) {
  const fake = { clientX: x, clientY: y };
  for (const f of _resizables) {
    if (f.root.style.display === 'none' || !f.active()) continue;
    if (_zoneFor(f, fake)) return true;
  }
  return false;
}
const _CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
function _zoneFor(f, e) {
  const r = f.root.getBoundingClientRect();
  const nx = e.clientX - r.left, ny = e.clientY - r.top;
  if (nx < -_REACH || ny < -_REACH || nx > r.width + _REACH || ny > r.height + _REACH) return '';
  // corners FIRST, independently of the edge bands: within 15px of a corner
  // point (in or out, the early return above already bounds the outside) the
  // grab is diagonal. _contentClaims still outranks everything at the call
  // sites, so a button or scrollbar living in that square keeps winning.
  const nearW = nx <= _CORNER, nearE = nx >= r.width - _CORNER;
  const nearN = ny <= _CORNER, nearS = ny >= r.height - _CORNER;
  if (nearN && nearW) return 'nw';
  if (nearN && nearE) return 'ne';
  if (nearS && nearW) return 'sw';
  if (nearS && nearE) return 'se';
  let z = '';
  if (ny < _BAND) z += 'n'; else if (ny > r.height - _BAND) z += 's';
  if (nx < _BAND) z += 'w'; else if (nx > r.width - _BAND) z += 'e';
  return z;
}
function _contentClaims(e) {
  // whatever really sits under the pointer: a scrollbar strip, a button, an
  // input — interactive content beats the grab; bare frame chrome does not
  for (let t = document.elementFromPoint(e.clientX, e.clientY); t instanceof HTMLElement; t = t.parentElement) {
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(t.tagName)) return true;
    if (t.scrollHeight > t.clientHeight + 1) {
      const sbw = t.offsetWidth - t.clientWidth;
      if (sbw > 0 && e.clientX >= t.getBoundingClientRect().right - sbw - 2) return true;
    }
    if (t.scrollWidth > t.clientWidth + 1) {
      const sbh = t.offsetHeight - t.clientHeight;
      if (sbh > 0 && e.clientY >= t.getBoundingClientRect().bottom - sbh - 2) return true;
    }
    if (t.classList?.contains('frame')) break;
  }
  return false;
}
function _hit(e) {
  const cands = _resizables.filter((f) => f.active());
  cands.sort((a, b) => (+b.root.style.zIndex || 0) - (+a.root.style.zIndex || 0));
  for (const f of cands) {
    const z = _zoneFor(f, e);
    if (z) return { f, z };
  }
  return null;
}
let _resizing = false;
document.addEventListener('pointermove', (e) => {
  if (_resizing) return;
  const h = _hit(e);
  document.body.style.cursor = (h && !_contentClaims(e)) ? _CURSORS[h.z] : '';
}, true);
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const h = _hit(e);
  if (!h || _contentClaims(e)) return;
  const { f, z } = h;
  e.preventDefault(); e.stopPropagation();
  f.raise();
  _resizing = true;
  const sx = e.clientX, sy = e.clientY;
  const s0 = { x: f.state.x, y: f.state.y, w: f.state.w, h: f.state.h };
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    // grows are clamped so no edge ever leaves the viewport (R, 08-29:
    // windows stay inside the active area, full stop)
    if (z.includes('e')) f.state.w = clamp(s0.w + dx, f.minW, innerWidth - s0.x - 8);
    if (z.includes('s')) f.state.h = clamp(s0.h + dy, f.minH, innerHeight - s0.y - 40);
    if (z.includes('w')) {
      const maxW = s0.x + s0.w - 8;                // west edge stops at x=8
      f.state.w = clamp(s0.w - dx, f.minW, maxW);
      f.state.x = s0.x + (s0.w - f.state.w);       // east side stays planted
    }
    if (z.includes('n')) {
      const maxH = s0.y + s0.h - 8;                // north edge stops at y=8
      f.state.h = clamp(s0.h - dy, f.minH, maxH);
      f.state.y = s0.y + (s0.h - f.state.h);       // south side stays planted
    }
    f.paint();
  };
  // ONE idempotent finish, shared by every way a drag can end. `pointerup`
  // alone is not enough: release the button outside the browser and `up` never
  // arrives, so `_resizing` stays true and the move/up listeners stay
  // installed — hover detection and all future resizes are dead until reload.
  // (The title-bar drag path has always taken pointer capture; this one was
  // written without it. Found in review.)
  let captureEl = null;          // whoever ACQUIRED the capture releases it
  let done = false;
  const finish = () => {
    if (done) return;                    // idempotent: several paths may fire
    done = true;
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    removeEventListener('blur', finish);
    // release on the element that ACQUIRED it. document.releasePointerCapture
    // was a no-op — Document does not own the capture, documentElement does —
    // so a blur/cancel could leave the capture live. (Review catch.)
    try {
      if (captureEl?.hasPointerCapture?.(e.pointerId)) captureEl.releasePointerCapture(e.pointerId);
    } catch { /* never captured, or gone */ }
    captureEl?.removeEventListener('lostpointercapture', finish);
    document.body.style.cursor = '';
    _resizing = false;
    f.save();
  };
  // capture keeps the stream coming while the pointer is outside the window;
  // lostpointercapture is then one more road to the same finish
  // one element owns the capture and the same one releases it; retained so
  // finish() cannot guess wrong
  try {
    document.documentElement.setPointerCapture(e.pointerId);
    captureEl = document.documentElement;
    captureEl.addEventListener('lostpointercapture', finish);
  } catch { /* no capture available — the listeners below still cover it */ }
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);
  addEventListener('blur', finish);
}, true);
let zTop = 30;
let locked = localStorage.getItem('ew-ui-locked') === '1';

const SNAP = 11;            // px — edge and frame-to-frame snapping distance
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function isLocked() { return locked; }
export function setLocked(v) {
  locked = v;
  localStorage.setItem('ew-ui-locked', v ? '1' : '0');
  document.body.classList.toggle('ui-locked', locked);
  bus.emit('ui-locked', locked);
}
document.body.classList.toggle('ui-locked', locked);

/**
 * @param id       stable key for the saved layout
 * @param opts     { title, x, y, w, h, minW, minH, resizable, collapsible,
 *                   closable, hidden, onResize }
 *                 x/y accept negatives to anchor from the right/bottom edge.
 */
export function makeFrame(id, opts = {}) {
  if (frames.has(id)) return frames.get(id);
  const {
    title = id, w = 300, h = 220, minW = 170, minH = 90,
    resizable = true, collapsible = true, closable = true,
    hidden = false, onResize = null, className = '',
  } = opts;

  const root = document.createElement('div');
  root.className = `frame panel ${className}`;
  root.dataset.frame = id;

  const head = document.createElement('div');
  head.className = 'fr-head';
  const ttl = document.createElement('span');
  ttl.className = 'fr-title';
  ttl.textContent = title;
  const btns = document.createElement('span');
  btns.className = 'fr-btns';
  head.append(ttl, btns);

  const body = document.createElement('div');
  body.className = 'fr-body';

  root.append(head, body);
  document.body.appendChild(root);

  // ---- state
  const saved = readSaved(id);
  const state = {
    x: saved?.x ?? resolveAnchor(opts.x, w, innerWidth),
    y: saved?.y ?? resolveAnchor(opts.y, h, innerHeight),
    w: saved?.w ?? w,
    h: saved?.h ?? h,
    collapsed: saved?.collapsed ?? false,
    hidden: saved?.hidden ?? hidden,
  };

  const api = {
    id, el: root, body, head,
    _state: state, _paint: () => paint(),      // live refs for the edge-rider
    get state() { return { ...state }; },
    show() {
      state.hidden = false;
      paint();
      // A hidden element measures zero, so a frame created hidden never got a
      // real position — it has to be fitted the first time it becomes visible.
      if (!fitted) { fitted = true; fit(); }
      save(); raise();
      return api;
    },
    hide() { state.hidden = true; paint(); save(); return api; },
    toggle() { state.hidden ? api.show() : api.hide(); return api; },
    get visible() { return !state.hidden; },
    collapse(v = !state.collapsed) { state.collapsed = v; paint(); save(); return api; },
    setTitle(t) { ttl.textContent = t; return api; },
    /** decorate the title bar (unread counts, status pips, …) */
    badge(html) {
      let b = head.querySelector('.fr-badge');
      if (!html) { b?.remove(); return api; }
      if (!b) { b = document.createElement('span'); b.className = 'fr-badge'; ttl.after(b); }
      b.innerHTML = html;
      return api;
    },
    raise,
    resetLayout() {
      localStorage.removeItem(LS(id));
      Object.assign(state, {
        x: resolveAnchor(opts.x, w, innerWidth),
        y: resolveAnchor(opts.y, h, innerHeight),
        w, h, collapsed: false, hidden,
      });
      paint();
      return api;
    },
  };

  function raise() { root.style.zIndex = String(++zTop); }
  function save() {
    localStorage.setItem(LS(id), JSON.stringify(state));
  }
  function paint() {
    root.style.display = state.hidden ? 'none' : 'flex';
    root.style.left = `${state.x}px`;
    root.style.top = `${state.y}px`;
    root.style.width = `${state.w}px`;
    root.classList.toggle('collapsed', state.collapsed);
    body.style.height = state.collapsed ? '0' : `${state.h}px`;
    // arrange-mode affordances: which viewport edges hold this frame (glow),
    // and whether the floating label must sit below (frame hugs the top)
    const hgt = root.offsetHeight || state.h;
    const st = stickyEdges(state, hgt);
    root.classList.toggle('st-l', st.l); root.classList.toggle('st-r', st.r);
    root.classList.toggle('st-t', st.t); root.classList.toggle('st-b', st.b);
    root.classList.toggle('label-below', state.y < 46);
    if (!state.collapsed) onResize?.(state.w, state.h);
  }

  // ---- buttons
  if (collapsible) {
    const b = document.createElement('button');
    b.className = 'fr-btn';
    b.title = 'collapse';
    b.textContent = '–';
    b.onclick = (e) => { e.stopPropagation(); api.collapse(); };
    btns.appendChild(b);
  }
  if (closable) {
    const b = document.createElement('button');
    b.className = 'fr-btn';
    b.title = 'close';
    b.textContent = '✕';
    b.onclick = (e) => { e.stopPropagation(); api.hide(); };
    btns.appendChild(b);
  }

  // ---- dragging
  head.addEventListener('pointerdown', (e) => {
    if (locked || e.target.closest('.fr-btn')) return;
    e.preventDefault();
    raise();
    root.classList.add('lifting');   // depth returns only while held
    const ox = e.clientX - state.x, oy = e.clientY - state.y;
    // capture can throw for a pointer id the browser doesn't know (synthetic
    // events, some touch stacks) — losing capture is survivable, aborting the
    // whole drag is not
    try { head.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    const move = (ev) => {
      state.x = ev.clientX - ox;
      state.y = ev.clientY - oy;
      snapPosition(id, state, root.offsetHeight);
      paint();
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      root.classList.remove('lifting');
      save();
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  // Alt+drag anywhere on the frame — the MMO habit, and it rescues a frame
  // whose title bar has been dragged off-screen.
  root.addEventListener('pointerdown', (e) => {
    if (locked || !e.altKey || !e.isTrusted) return;   // isTrusted: our own
    // re-dispatch below bubbles back through this capture handler — without
    // the guard it recurses to stack overflow (exposed when heads went
    // display:none and alt-drag became the only rest-state move).
    e.preventDefault(); e.stopPropagation();
    head.dispatchEvent(new PointerEvent('pointerdown', e));
  }, true);

  // ---- resizing: registered with the module-level edge hit-tester (below) —
  // one document listener serves every frame, which is the only way to grab
  // OUTSIDE a frame's border without an overlay stealing its content's events
  // (the ::before halo painted over scrollbars and buttons — R, 17:20).
  if (resizable) _resizables.push({ root, state, minW, minH, paint, save, raise,
    active: () => !locked && !state.collapsed && !state.hidden });

  root.addEventListener('pointerdown', raise);
  head.addEventListener('dblclick', () => api.collapse());

  frames.set(id, api);
  paint();
  // The anchor was computed from the BODY height, but a frame is also a title
  // bar and whatever padding its content carries — so a bottom-anchored frame
  // hung its composer off the screen. Measure once it exists and pull it back.
  let fitted = false;
  if (!saved && !state.hidden) { fitted = true; fit(); }
  addEventListener('resize', fit);

  function fit() {
    const hh = root.offsetHeight;
    if (!hh) return;
    if (opts.y != null && opts.y < 0) state.y = Math.max(8, innerHeight + opts.y - hh);
    state.y = clamp(state.y, 8, Math.max(8, innerHeight - hh - 8));
    state.x = clamp(state.x, 8, Math.max(8, innerWidth - state.w - 8));
    paint();
  }

  return api;
}

function resolveAnchor(v, size, extent) {
  if (v == null) return 40;
  return v < 0 ? Math.max(8, extent + v - size) : v;
}

function readSaved(id) {
  try { return JSON.parse(localStorage.getItem(LS(id)) ?? 'null'); } catch { return null; }
}

/** Edge snapping, plus snapping to the other frames' edges — it's what makes a
 *  hand-arranged layout look deliberate instead of approximate. */
function snapPosition(id, state, height) {
  const edges = [{ x: 8 }, { x: innerWidth - state.w - 8 }, { y: 8 }, { y: innerHeight - height - 8 }];
  for (const o of frames.values()) {
    if (o.id === id || !o.visible) continue;
    const r = o.el.getBoundingClientRect();
    edges.push({ x: r.left }, { x: r.right - state.w }, { x: r.right + 6 }, { x: r.left - state.w - 6 });
    edges.push({ y: r.top }, { y: r.bottom - height }, { y: r.bottom + 6 }, { y: r.top - height - 6 });
  }
  for (const e of edges) {
    if (e.x != null && Math.abs(state.x - e.x) < SNAP) state.x = e.x;
    if (e.y != null && Math.abs(state.y - e.y) < SNAP) state.y = e.y;
  }
  // fully inside the viewport, always (no more parking a window half off-screen)
  state.x = clamp(state.x, 8, Math.max(8, innerWidth - state.w - 8));
  state.y = clamp(state.y, 8, Math.max(8, innerHeight - height - 8));
}

// ---- viewport-edge stickiness ----------------------------------------------
// A frame resting against a pane edge belongs to that edge: when the window
// resizes, it rides the edge instead of being stranded mid-air. Sticky edges
// glow in arrangement mode so the behavior is legible before it fires.
const STICKY = 16;
function stickyEdges(state, height) {
  return {
    l: state.x <= 8 + STICKY,
    r: innerWidth - (state.x + state.w) <= 8 + STICKY,
    t: state.y <= 8 + STICKY,
    b: innerHeight - (state.y + height) <= 8 + STICKY,
  };
}
let _lastVW = innerWidth, _lastVH = innerHeight;

// Ride the edges: frames sticky to right/bottom keep their edge gap when the
// window resizes; everything is then clamped back inside regardless.
addEventListener('resize', () => {
  const dw = innerWidth - _lastVW, dh = innerHeight - _lastVH;
  for (const f of frames.values()) {
    const st = f._state; if (!st) continue;
    const hgt = f.el.offsetHeight || st.h;
    // stickiness judged against the OLD viewport (pre-resize geometry)
    const wasR = _lastVW - (st.x + st.w) <= 8 + STICKY;
    const wasB = _lastVH - (st.y + hgt) <= 8 + STICKY;
    if (wasR && !(st.x <= 8 + STICKY)) st.x += dw;
    if (wasB && !(st.y <= 8 + STICKY)) st.y += dh;
    st.x = clamp(st.x, 8, Math.max(8, innerWidth - st.w - 8));
    st.y = clamp(st.y, 8, Math.max(8, innerHeight - hgt - 8));
    f._paint?.();
  }
  _lastVW = innerWidth; _lastVH = innerHeight;
});

export function getFrame(id) { return frames.get(id); }
export function allFrames() { return [...frames.values()]; }
export function resetLayout() {
  for (const f of frames.values()) f.resetLayout();
  setLocked(false);
}
