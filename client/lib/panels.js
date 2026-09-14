// panels — schema-driven edit surfaces (R's design, 2026-08-04 21:52).
//
// A panel is a FRAME on desktop and a laser-clickable QUAD in VR, and the way
// that stays true is that a panel never owns bespoke DOM: it declares FIELDS —
// a serializable schema — and a renderer builds them. Two renderers live here,
// one target each, sharing the schema and a single action dispatcher:
//
//   renderDOM(body, fields, edit)              → frame body (desktop)
//   renderCanvas(canvas, fields) → hit regions → quad texture (VR); a laser
//     UV-hit resolves to a region and dispatches the SAME edit(action, payload)
//
// Field design rule (R, 21:58): every field must be operable with no keyboard —
// numbers are steppers, actions are buttons, lists are rows. Free-text exists
// on desktop (rename, comp JSON) and degrades to display-only in VR rather
// than summoning a keyboard nobody wants to float-type on.
//
// field specs (plain JSON, no closures — actions are string keys):
//   { t:'info',   label, value }
//   { t:'num',    k, label, value, step=0.1, dp=2, min?, max?, softMin?, softMax?,
//                 unit?, deg?, compact?, drag? }                  → edit(k, newValue)
//   { t:'vec3',   k, label, value:[x,y,z], step=0.1, dp=2, link? } → edit(k, [x,y,z], axis|null)
//   { t:'text',   k, label, value, placeholder? }                 → edit(k, string)  [desktop only]
//   { t:'btn',    k, label, danger? }                             → edit(k)
//   { t:'list',   k?, label, empty?, rows:[{ id, label, sub?, active?,
//                 actions:[{k, label, danger?}] }] }              → edit(a.k, rowId) / edit(k ?? 'row', rowId)
//   { t:'check',  k, label, value, hint? }                        → edit(k, bool)
//   { t:'enum',   k, label, value, options:[{v,label}] }          → edit(k, v)
//   { t:'color',  k, label, value:0xRRGGBB }                      → edit(k, int)
//   { t:'group',  k, label, open? }   marker: rows until the next marker belong to it;
//                 collapsed groups skip their rows                → edit('fold', k)
//   { t:'tree',   k, rows:[{ id, label, sub?, depth, active?, multi?, badges?:[], locked?, menu?, kids?, open?, dim? }],
//                 a Shift/Ctrl-click row dispatches edit(k, id, f, {extend:true}); dragging a row onto
//                 another dispatches edit('drop', {id, onto}) — onto empty tree space: {onto: null}
//                 menu?:[{k, label, danger?}] }   right-click a row → its menu (row.menu wins)
//                 kids>0 draws a disclosure → edit('open', id)   → edit(k, id) / edit('lock', id) / edit(item.k, id)
// Every field also takes { disabled?, driven?, hint? }: disabled draws it
// read-only (a locked thing's pose); driven names what owns the value (a
// motion comp composes onto this rest pose) and tints the row — Blender's
// purple-driver / Maya's channel colour, as ambient provenance.
//
// The dispatcher is edit(k, value, field?, opts?). `field` is Godot's third
// signal arg (an axis index for vec3) so multi-select can assign one component
// without clobbering the others. `opts.live` is true while a drag is in
// progress: PREVIEW locally, no log traffic; a call without it is the gesture
// ending — commit ONE verb.
//
// num entry (desktop): drag the number to scrub — Godot's EditorSpinSlider
// shape (editor_spin_slider.cpp:108-136): the value is ALWAYS start + step ×
// distance, never accumulated, so a drag that wanders comes back to exactly
// where it began (Blender's #37453 drift is the failure this avoids). Shift =
// 0.1×, Ctrl = snap to whole units, Esc mid-drag restores the start value.
// Click without travel focuses the box to type; typed entry takes Maya's
// relative math: `+=2`, `-=.5`, `*=-1`, `/=2`, `+=10%`. Soft limits bound the
// drag; hard limits bound everything.

import { makeFrame } from './frames.js';
import { parseEntry } from '../../shared/editschema.js';
export { parseEntry };

// ---------------------------------------------------------------- DOM renderer

export function makeSchemaFrame(key, opts) {
  const frame = makeFrame(key, opts);
  frame.body.classList.add('schema-panel');
  // inner scroller — see .schema-scroll in index.html: a scrollbar on the body
  // itself steals the edge-resize band's pixels
  const scroll = document.createElement('div');
  scroll.className = 'schema-scroll';
  frame.body.append(scroll);
  guardActions(scroll);
  let live = null;                 // { key, rows, box } of the current paint
  let lastFields = null, pendingWhileFocused = false;

  function set(fields, edit) {
    lastFields = { fields, edit };
    // Same shape as what is on screen → update values in place: no node is
    // destroyed, a hovered button stays hovered, a scroll position holds.
    // (Godot routes a changed property to its one widget through
    // editor_property_map, editor_inspector.cpp:4870; this is that.)
    const key = shapeKey(fields);
    if (live && live.key === key) {
      live.box.edit = edit;
      fields.forEach((f, i) => live.rows[i]?.update?.(f));
      return;
    }
    // Rebuilding under a focused input eats the caret mid-edit; hold the
    // refresh until focus leaves the panel, then paint the queued state.
    if (scroll.contains(document.activeElement) &&
        /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      if (!pendingWhileFocused) {
        pendingWhileFocused = true;
        document.activeElement.addEventListener('blur', () => {
          pendingWhileFocused = false;
          if (lastFields) set(lastFields.fields, lastFields.edit);
        }, { once: true });
      }
      return;
    }
    live = { key, ...renderDOM(scroll, fields, edit) };
  }
  return { frame, set };
}

/** What makes two paints the same SHAPE: types, keys, fold state, options,
 *  and list membership. Values and labels are not shape — they update in
 *  place. */
export function shapeKey(fields) {
  return fields.map((f) => [f.t, f.k ?? '', f.disabled ? 1 : 0, f.driven ?? '',
    f.t === 'group' ? (f.open !== false ? 'o' : 'c') : '',
    f.t === 'enum' ? JSON.stringify(f.options ?? []) : '',
    (f.t === 'tree' || f.t === 'list') ? JSON.stringify(f.rows ?? []) : '',
    f.t === 'vec3' ? (f.link ? 'L' : '') : '',
  ].join('|')).join('\n');
}

/** Nav/action separation: a drag that BEGINS on a button must scroll, never
 *  fire the button. Resonite #707 / Neos #1040 — eight years of "I scrolled
 *  the component list and it nulled a field". Measured from pointerdown; a
 *  click that travelled is swallowed at capture, before any onclick. */
function guardActions(root) {
  let down = null;
  root.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, true);
  // a release outside the scroller never clicks it: forget the origin, or the
  // next keyboard activation (clientX/Y 0) reads as travel and is swallowed
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { setTimeout(() => { down = null; }, 0); }, true);
  root.addEventListener('click', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6 && !e.target.closest('.sp-num')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

let treeDrag = null;   // the tree row being dragged (id), across the dragstart → drop pair

export function renderDOM(body, fields, edit) {
  body.innerHTML = '';
  const box = { edit };
  const via = (...a) => box.edit(...a);
  const rows = [];
  let folded = false;
  for (const f of fields) {
    let row = null;
    if (f.t === 'group') { folded = f.open === false; row = fieldDOM(f, via); }
    else if (!folded) row = fieldDOM(f, via);
    rows.push(row);
    if (row) body.append(row);
  }
  return { rows, box };
}

/** One context menu at a time, anywhere; closes on a click, Esc, or scroll. */
export function contextMenu(x, y, items, pick) {
  closeContextMenu();
  const m = el('div', 'sp-ctx');
  for (const it of items) {
    const b = el('button', `sp-ctx-item${it.danger ? ' danger' : ''}`, it.label);
    b.onclick = () => { closeContextMenu(); pick(it.k); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 6)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 6)}px`;
  const off = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'pointerdown' && m.contains(e.target)) return; closeContextMenu(); };
  m._off = off;
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, off, true);
  return m;
}
export function closeContextMenu() {
  const m = document.querySelector('.sp-ctx');
  if (!m) return;
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.removeEventListener(ev, m._off, true);
  m.remove();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const R2D = 180 / Math.PI;

function stepper(value, f, commit) {
  const cur = { step: 0.1, dp: 2, ...f };   // options are LIVE: update() refreshes them (a typed value past softMax raises the next drag's cap)
  const { unit, deg, compact, disabled } = cur;
  const wrap = el('span', `sp-step${compact ? ' compact' : ''}`);
  const num = el('input', 'sp-num');
  num.type = 'text'; num.inputMode = 'decimal'; num.autocomplete = 'off'; num.spellcheck = false;
  if (disabled) num.disabled = true;
  const toFace = (w) => (deg ? w * R2D : w).toFixed(deg ? 0 : cur.dp);
  const toWire = (face) => (deg ? face / R2D : face);
  const hard = (w) => Math.min(cur.max ?? Infinity, Math.max(cur.min ?? -Infinity, w));
  const soft = (w) => Math.min(cur.softMax ?? cur.max ?? Infinity, Math.max(cur.softMin ?? cur.min ?? -Infinity, w));
  let wire = +value;
  const show = (w) => { num.value = toFace(w); };
  show(wire);
  const send = (w, o) => { wire = hard(w); show(wire); commit(wire, o); };

  // typed entry: relative math against the CURRENT face value, hard limits
  num.onchange = () => {
    const face = parseEntry(num.value, +toFace(wire));
    if (face == null) { show(wire); return; }
    send(toWire(face));
    num.blur();   // release focus so held repaints resume
  };
  num.onkeydown = (e) => {
    if (e.key === 'Escape') { show(wire); num.blur(); e.stopPropagation(); }
    else if (e.key === 'Enter') { num.onchange(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * cur.step * (e.shiftKey ? 10 : 1);
      send(toWire(+toFace(wire) + d));
    }
  };

  // drag-to-scrub: absolute from origin, on the FACE scale, soft limits
  const perPx = () => cur.drag ?? cur.step * 0.2;
  let drag = null;
  // Esc while scrubbing: the input was BLURRED when the drag armed (so the
  // caret never fights the pointer), which means the key lands on the
  // document, not here — listen there, only while a drag is armed
  const onDragKey = (e) => { if (e.key === 'Escape' && drag?.armed) { e.stopImmediatePropagation(); e.preventDefault(); cancelDrag(); } };   // immediate: the global key router (controller.js) must not also see it and deselect
  const cancelDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    document.removeEventListener('keydown', onDragKey, true);
    num.classList.remove('scrub');
    try { num.releasePointerCapture(d.id); } catch { /* already released */ }
    if (d.armed) { show(d.w0); commit(d.w0, { live: true }); wire = d.w0; }
  };
  num.addEventListener('pointerdown', (e) => {
    if (disabled || e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, lastX: e.clientX, w0: wire, face0: +toFace(wire), dist: 0, armed: false };
  });
  num.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.lastX; drag.lastX = e.clientX;
    // accumulate BEFORE the arm check (Godot :113 then :117): the pixels
    // inside the click slop still count, or a drag that wanders back lands
    // short of where it began — the drift this whole shape exists to avoid
    drag.dist += dx * (e.shiftKey ? 0.1 : 1);
    if (!drag.armed) {
      if (Math.abs(e.clientX - drag.x0) < 4) return;           // click-vs-drag slop
      drag.armed = true;
      try { num.setPointerCapture(drag.id); } catch { /* no capture here */ }
      num.classList.add('scrub');
      num.blur();
      document.addEventListener('keydown', onDragKey, true);
    }
    let face = drag.face0 + drag.dist * perPx();
    if (e.ctrlKey || e.metaKey) face = Math.round(face);
    const w = soft(toWire(face));
    drag.cur = w; wire = w; show(w);
    commit(w, { live: true });
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.armed) {
      document.removeEventListener('keydown', onDragKey, true);
      num.classList.remove('scrub');
      try { num.releasePointerCapture(d.id); } catch { /* fine */ }
      if (d.cur != null && d.cur !== d.w0) commit(d.cur); else if (d.cur != null) commit(d.w0, { live: true });
    } else if (e.type === 'pointerup') { num.focus(); num.select(); }   // a click: type
  };
  num.addEventListener('pointerup', endDrag);
  num.addEventListener('pointercancel', endDrag);
  num.addEventListener('lostpointercapture', () => { if (drag?.armed) endDrag({ type: 'lost' }); });

  if (!compact) {
    const minus = el('button', 'sp-bump', '−');
    const plus = el('button', 'sp-bump', '+');
    minus.disabled = plus.disabled = !!disabled;
    minus.onclick = () => send(toWire(+toFace(wire) - cur.step));
    plus.onclick = () => send(toWire(+toFace(wire) + cur.step));
    wrap.append(minus, num, plus);
  } else wrap.append(num);
  if (unit || deg) wrap.append(el('span', 'sp-unit', deg ? '°' : unit));

  // in-place update from a repaint: never under a caret or a drag
  wrap.update = (nf) => {
    Object.assign(cur, nf);
    if (drag || document.activeElement === num) return;
    wire = +nf.value; show(wire);
  };
  return wrap;
}

function fieldDOM(f, edit) {
  const row = el('div', `sp-row sp-f-${f.t}`);   // sp-f- prefix: never collide with element classes
  if (f.disabled) row.classList.add('disabled');
  if (f.driven) { row.classList.add('driven'); row.title = `driven by ${f.driven}`; }
  else if (f.hint) row.title = f.hint;
  let label = null;
  if (f.label != null && f.t !== 'btn' && f.t !== 'group') { label = el('label', 'sp-label', f.label); row.append(label); }
  const setLabel = (nf) => { if (label && nf.label != null) label.textContent = nf.label; };
  switch (f.t) {
    case 'info': {
      const s = el('span', 'sp-info', String(f.value ?? ''));
      row.append(s);
      row.update = (nf) => { setLabel(nf); s.textContent = String(nf.value ?? ''); };
      break;
    }
    case 'num': {
      const st = stepper(f.value ?? 0, f, (v, o) => edit(f.k, v, null, o));
      row.append(st);
      row.update = (nf) => { setLabel(nf); st.update(nf); };
      break;
    }
    case 'vec3': {
      const box = el('span', 'sp-vec');
      let cur = [...(f.value ?? [0, 0, 0])];
      const parts = cur.map((c, i) => stepper(c, f, (v, o) => {
        if (f.link) { cur = [v, v, v]; edit(f.k, cur, null, o); return; }
        cur = [...cur]; cur[i] = v; edit(f.k, cur, i, o);
      }));
      box.append(...parts);
      row.append(box);
      row.update = (nf) => { setLabel(nf); cur = [...(nf.value ?? cur)]; parts.forEach((p, i) => p.update({ value: cur[i] })); };
      break;
    }
    case 'enum': {
      const sel = el('select', 'sp-enum');
      sel.disabled = !!f.disabled;
      for (const o of f.options ?? []) {
        const op = new Option(o.label ?? String(o.v), String(o.v));
        op.selected = o.v === f.value;
        sel.append(op);
      }
      sel.onchange = () => { const o = (f.options ?? []).find((x) => String(x.v) === sel.value); edit(f.k, o ? o.v : sel.value); };
      row.append(sel);
      row.update = (nf) => { setLabel(nf); if (document.activeElement !== sel) sel.value = String(nf.value); };
      break;
    }
    case 'color': {
      const inp = el('input', 'sp-color');
      inp.type = 'color';
      inp.disabled = !!f.disabled;
      const hex = (v) => '#' + (v ?? 0xffffff).toString(16).padStart(6, '0');
      inp.value = hex(f.value);
      inp.oninput = () => edit(f.k, parseInt(inp.value.slice(1), 16), null, { live: true });
      inp.onchange = () => { edit(f.k, parseInt(inp.value.slice(1), 16)); inp.blur(); };
      row.append(inp);
      row.update = (nf) => { setLabel(nf); if (document.activeElement !== inp) inp.value = hex(nf.value); };
      break;
    }
    case 'group': {
      row.classList.add(f.open === false ? 'closed' : 'open');
      const h = el('button', 'sp-group', `${f.open === false ? '▸' : '▾'} ${f.label}`);
      h.onclick = () => edit('fold', f.k);
      row.innerHTML = ''; row.append(h);
      row.update = (nf) => { h.textContent = `${nf.open === false ? '▸' : '▾'} ${nf.label}`; };
      break;
    }
    case 'tree': {
      const box = el('div', 'sp-tree');
      if (!f.rows?.length) box.append(el('div', 'sp-empty', f.empty ?? 'nothing here'));
      // drag a row onto another to reparent it (edit('drop', {id, onto})); onto
      // the tree's empty space to make it a root ({onto: null}). The dragged
      // id rides a module variable, not dataTransfer — synthetic DragEvents
      // in a headless bench carry no data, and nothing else needs it.
      const dropOn = (onto) => (e) => { e.preventDefault(); e.stopPropagation(); box.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); if (treeDrag && treeDrag !== onto) edit('drop', { id: treeDrag, onto }); treeDrag = null; };
      box.ondragover = (e) => { if (treeDrag) { e.preventDefault(); e.dataTransfer && (e.dataTransfer.dropEffect = 'move'); } };
      box.ondrop = dropOn(null);
      for (const r of f.rows ?? []) {
        const line = el('div', `sp-item sp-tree-row${r.active ? ' active' : ''}${r.multi ? ' multi' : ''}`);
        if (!r.noDrag) {
          line.draggable = true;
          line.ondragstart = (e) => { treeDrag = r.id; line.classList.add('dragging'); e.dataTransfer?.setData('text/plain', String(r.id)); };
          line.ondragend = () => { treeDrag = null; line.classList.remove('dragging'); box.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); };
          line.ondragover = (e) => { if (treeDrag && treeDrag !== r.id) { e.preventDefault(); e.stopPropagation(); line.classList.add('drop'); } };
          line.ondragleave = () => line.classList.remove('drop');
          line.ondrop = dropOn(r.id);
        }
        line.style.paddingLeft = `${4 + (r.depth ?? 0) * 14}px`;
        if (r.dim) line.classList.add('dim');
        // disclosure: a row with children folds them (edit('open', id))
        const disc = el('button', `sp-disc${r.kids ? '' : ' none'}`, r.kids ? (r.open === false ? '▸' : '▾') : '');
        disc.tabIndex = -1;
        if (r.kids) disc.onclick = (e) => { e.stopPropagation(); edit('open', r.id); };
        line.append(disc);
        const main = el('span', 'sp-item-main');
        main.append(el('span', 'sp-item-label', r.label));
        if (r.sub || r.badges?.length) main.append(el('span', 'sp-item-sub', [r.sub, ...(r.badges ?? [])].filter(Boolean).join(' · ')));
        main.onclick = (e) => edit(f.k, r.id, f, { extend: e.shiftKey || e.ctrlKey || e.metaKey });   // Shift/Ctrl-click extends a selection
        const items = r.menu ?? f.menu;
        if (items?.length) line.oncontextmenu = (e) => { e.preventDefault(); contextMenu(e.clientX, e.clientY, items, (k) => edit(k, r.id)); };
        line.append(main);
        if (r.locked != null) {
          const lock = el('button', `sp-mini${r.locked ? ' on' : ''}`, r.locked ? '🔒' : '🔓');
          lock.title = r.locked ? 'locked — click to unlock' : 'click to lock in place';
          lock.onclick = (e) => { e.stopPropagation(); edit('lock', r.id); };
          line.append(lock);
        }
        box.append(line);
      }
      row.append(box);
      break;   // rows are shape: a changed tree repaints
    }
    case 'text': {
      const inp = el('input', 'sp-text');
      inp.value = f.value ?? '';
      inp.disabled = !!f.disabled;
      if (f.placeholder) inp.placeholder = f.placeholder;
      inp.onchange = () => { edit(f.k, inp.value); inp.blur(); };
      inp.onkeydown = (e) => { if (e.key === 'Escape') { inp.value = f.value ?? ''; inp.blur(); e.stopPropagation(); } };
      row.append(inp);
      row.update = (nf) => { setLabel(nf); if (document.activeElement !== inp) inp.value = nf.value ?? ''; };
      break;
    }
    case 'btn': {
      const b = el('button', `sp-btn${f.danger ? ' danger' : ''}`, f.label);
      b.disabled = !!f.disabled;
      b.onclick = () => edit(f.k);
      row.append(b);
      row.update = (nf) => { b.textContent = nf.label; };
      break;
    }
    case 'check': {
      const inp = el('input');
      inp.type = 'checkbox';
      inp.checked = !!f.value;
      inp.disabled = !!f.disabled;
      inp.onchange = () => edit(f.k, inp.checked);
      row.append(inp);
      row.update = (nf) => { setLabel(nf); inp.checked = !!nf.value; };
      break;
    }
    case 'list': {
      const box = el('div', 'sp-list');
      if (!f.rows?.length) box.append(el('div', 'sp-empty', f.empty ?? 'nothing here'));
      for (const r of f.rows ?? []) {
        const line = el('div', `sp-item${r.active ? ' active' : ''}`);
        const main = el('span', 'sp-item-main');
        main.append(el('span', 'sp-item-label', r.label));
        if (r.sub) main.append(el('span', 'sp-item-sub', r.sub));
        main.onclick = () => edit(f.k ?? 'row', r.id);   // a keyed list routes its rows; unkeyed lists keep 'row'
        line.append(main);
        for (const a of r.actions ?? []) {
          const b = el('button', `sp-mini${a.danger ? ' danger' : ''}`, a.label);
          b.onclick = (e) => { e.stopPropagation(); edit(a.k, r.id); };
          line.append(b);
        }
        box.append(line);
      }
      row.append(box);
      break;
    }
  }
  return row;
}

// ---------------------------------------------------------------- canvas renderer
// The VR seam. Same fields, painted to a 2D canvas; returns hit REGIONS in
// canvas pixels so xr.js can turn a laser UV-hit into the same edit() call.
// Text fields render display-only here on purpose (no floating keyboards).

const C = {
  bg: '#101318', row: '#161b22', label: '#8b96a5', text: '#e8edf4',
  accent: '#e8956b', danger: '#e06060', line: '#242b35', driven: '#b48cff',
};

export function renderCanvas(canvas, fields, { width = 512, rowH = 44, pad = 12, title = '' } = {}) {
  const rows = [];
  let folded = false;
  for (const f of fields) {
    if (f.t === 'group') { folded = f.open === false; rows.push(f); continue; }
    if (folded) continue;
    rows.push(f, ...(f.t === 'list' || f.t === 'tree' ? (f.rows ?? []).map((r) => ({ _row: r, parent: f })) : []));
  }
  const H = (title ? rowH : 0) + rows.length * rowH + pad * 2;
  canvas.width = width; canvas.height = H;
  const g = canvas.getContext('2d');
  const regions = [];
  g.fillStyle = C.bg; g.fillRect(0, 0, width, H);
  let y = pad;
  const font = (px, w = 400) => { g.font = `${w} ${px}px system-ui, sans-serif`; };

  if (title) {
    font(18, 600); g.fillStyle = C.accent;
    g.fillText(title, pad, y + rowH * 0.62);
    y += rowH;
  }
  for (const f of rows) {
    if (f._row) { // a list or tree row
      const r = f._row; const tree = f.parent.t === 'tree';
      const ind = tree ? (r.depth ?? 0) * 18 : 0;
      g.fillStyle = r.active ? '#1d2634' : C.row;
      g.fillRect(pad, y + 2, width - pad * 2, rowH - 4);
      font(15, r.active ? 600 : 400); g.fillStyle = C.text;
      g.fillText(String(r.label).slice(0, 34), pad + 10 + ind, y + rowH * 0.62);
      if (tree && (r.sub || r.badges?.length)) {
        font(11); g.fillStyle = C.label;
        g.fillText([r.sub, ...(r.badges ?? [])].filter(Boolean).join(' · ').slice(0, 40), pad + 10 + ind + Math.min(220, r.label.length * 9 + 14), y + rowH * 0.62);
      }
      regions.push({ x: pad, y, w: width * 0.6, h: rowH, action: f.parent.k ?? 'row', payload: r.id });
      if (tree && r.kids) {   // a disclosure glyph, its own hit region ahead of the row's
        font(13); g.fillStyle = C.label; g.fillText(r.open === false ? '▸' : '▾', pad + ind - 4, y + rowH * 0.62);
        regions.unshift({ x: pad + ind - 8, y, w: 16, h: rowH, action: 'open', payload: r.id });
      }
      if (tree) {
        const bw = 34, bx = width - pad - bw;
        g.fillStyle = r.locked ? C.accent : '#2a3342';
        g.fillRect(bx, y + 7, bw, rowH - 14);
        font(13, 600); g.fillStyle = r.locked ? '#14100c' : C.text;
        g.fillText(r.locked ? 'L' : 'l', bx + 12, y + rowH * 0.62);
        regions.push({ x: bx, y: y + 7, w: bw, h: rowH - 14, action: 'lock', payload: r.id });
        y += rowH; continue;
      }
      let bx = width - pad;
      for (const a of [...(r.actions ?? [])].reverse()) {
        const bw = Math.max(52, a.label.length * 9 + 18);
        bx -= bw + 6;
        g.fillStyle = a.danger ? C.danger : '#2a3342';
        g.fillRect(bx, y + 7, bw, rowH - 14);
        font(13, 500); g.fillStyle = C.text;
        g.fillText(a.label, bx + 9, y + rowH * 0.6);
        regions.push({ x: bx, y: y + 7, w: bw, h: rowH - 14, action: a.k, payload: r.id });
      }
      y += rowH; continue;
    }
    if (f.t === 'group') {
      g.fillStyle = C.line; g.fillRect(pad, y + rowH - 6, width - pad * 2, 1);
      font(14, 600); g.fillStyle = C.accent;
      g.fillText(`${f.open === false ? '▸' : '▾'} ${f.label}`, pad, y + rowH * 0.62);
      regions.push({ x: pad, y, w: width - pad * 2, h: rowH, action: 'fold', payload: f.k });
      y += rowH; continue;
    }
    if (f.label != null) { font(13); g.fillStyle = f.driven ? C.driven : C.label; g.fillText(f.label, pad, y + rowH * 0.6); }
    const vx = width * 0.34;
    const mark = regions.length;   // a disabled field paints but takes no hits
    switch (f.t) {
      case 'enum': {
        let bx = vx;
        for (const o of f.options ?? []) {
          const lab = String(o.label ?? o.v); const bw = Math.max(40, lab.length * 8 + 16);
          const on = o.v === f.value;
          g.fillStyle = on ? C.accent : '#2a3342';
          g.fillRect(bx, y + 7, bw, rowH - 14);
          font(13, on ? 600 : 400); g.fillStyle = on ? '#14100c' : C.text;
          g.fillText(lab, bx + 8, y + rowH * 0.62);
          regions.push({ x: bx, y: y + 7, w: bw, h: rowH - 14, action: f.k, payload: o.v });
          bx += bw + 4;
          if (bx > width - pad - 40) break;
        }
        break;
      }
      case 'color': {
        const s = rowH - 14;
        g.fillStyle = '#' + (f.value ?? 0xffffff).toString(16).padStart(6, '0');
        g.fillRect(vx, y + 7, s * 1.6, s);
        g.strokeStyle = C.label; g.lineWidth = 1; g.strokeRect(vx, y + 7, s * 1.6, s);
        // an 8-swatch palette: the keyboard-free way to pick a color
        const PAL = [0xffffff, 0xffd9a0, 0xff8a5c, 0xe05a5a, 0x7cc47c, 0x5fa8ff, 0xb48cff, 0x202020];
        let bx = vx + s * 1.6 + 8;
        for (const c of PAL) {
          g.fillStyle = '#' + c.toString(16).padStart(6, '0');
          g.fillRect(bx, y + 9, s - 4, s - 4);
          regions.push({ x: bx, y: y + 9, w: s - 4, h: s - 4, action: f.k, payload: c });
          bx += s;
        }
        break;
      }
      case 'info': font(15); g.fillStyle = C.text; g.fillText(String(f.value ?? '').slice(0, 30), vx, y + rowH * 0.6); break;
      case 'text': font(15); g.fillStyle = C.label; g.fillText(String(f.value ?? '—').slice(0, 26), vx, y + rowH * 0.6); break;
      case 'btn': {
        const bw = Math.max(90, f.label.length * 9 + 24);
        g.fillStyle = f.danger ? C.danger : C.accent;
        g.fillRect(pad, y + 6, bw, rowH - 12);
        font(15, 600); g.fillStyle = '#14100c';
        g.fillText(f.label, pad + 12, y + rowH * 0.62);
        regions.push({ x: pad, y: y + 6, w: bw, h: rowH - 12, action: f.k });
        break;
      }
      case 'check': {
        const s = rowH - 16;
        g.strokeStyle = C.label; g.lineWidth = 2;
        g.strokeRect(vx, y + 8, s, s);
        if (f.value) {
          g.strokeStyle = C.accent; g.lineWidth = 3;
          g.beginPath();
          g.moveTo(vx + s * 0.2, y + 8 + s * 0.55);
          g.lineTo(vx + s * 0.45, y + 8 + s * 0.8);
          g.lineTo(vx + s * 0.85, y + 8 + s * 0.2);
          g.stroke();
        }
        regions.push({ x: vx, y: y + 8, w: s, h: s, action: f.k, payload: !f.value });
        break;
      }
      case 'num': paintStepper(g, regions, f, +(f.value ?? 0), vx, y, rowH, f.k, null, f.dp); break;
      case 'vec3': {
        const seg = (width - vx - pad) / 3;
        (f.value ?? [0, 0, 0]).forEach((c, i) =>
          paintStepper(g, regions, f, +c, vx + seg * i, y, rowH, f.k, f.link ? null : i, f.dp, seg - 8));
        break;
      }
    }
    if (f.disabled) regions.length = mark;
    y += rowH;
  }
  return regions;
}

function paintStepper(g, regions, f, val, x, y, rowH, k, axis, dp = 2, w = 150) {
  const bump = 26, mid = w - bump * 2;
  g.fillStyle = '#2a3342';
  g.fillRect(x, y + 7, bump, rowH - 14);
  g.fillRect(x + bump + mid, y + 7, bump, rowH - 14);
  g.fillStyle = C.row; g.fillRect(x + bump, y + 7, mid, rowH - 14);
  g.font = '600 16px system-ui'; g.fillStyle = C.text;
  g.fillText('−', x + 8, y + rowH * 0.62);
  g.fillText('+', x + bump + mid + 7, y + rowH * 0.62);
  g.font = '500 14px system-ui';
  const face = f.deg ? `${Math.round(val * R2D)}°` : val.toFixed(dp) + (f.unit ? ` ${f.unit}` : '');
  g.fillText(face, x + bump + 8, y + rowH * 0.62);
  // deltas are on the WIRE scale (radians for deg fields): the dispatcher adds
  // them to the current value and never has to know what the face showed
  const d = f.deg ? (f.step ?? 1) / R2D : (f.step ?? 0.1);
  regions.push({ x, y: y + 7, w: bump, h: rowH - 14, action: k, payload: { axis, delta: -d } });
  regions.push({ x: x + bump + mid, y: y + 7, w: bump, h: rowH - 14, action: k, payload: { axis, delta: +d } });
}

/** A canvas stepper reports { axis, delta } (it has no value to add to); a
 *  dispatcher that expects the NUMBER the DOM path sends resolves it here
 *  against the painted field. Numbers pass through untouched. */
export function resolveDelta(fields, k, payload) {
  if (!(typeof payload === 'object' && payload && 'delta' in payload)) return payload;
  const f = fields.find((x) => x.k === k);
  if (!f) return null;
  if (f.t === 'vec3') { const v = [...(f.value ?? [0, 0, 0])]; const i = payload.axis ?? 0; v[i] = +v[i] + payload.delta; return v; }
  return +(f.value ?? 0) + payload.delta;
}

/** Resolve a UV hit (0..1, v measured from the top) against regions. */
export function hitRegion(regions, canvas, u, v) {
  const x = u * canvas.width, y = v * canvas.height;
  return regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
}
