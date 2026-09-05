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
//   { t:'num',    k, label, value, step=0.1, dp=2, min?, max? }   → edit(k, newValue)
//   { t:'vec3',   k, label, value:[x,y,z], step=0.1, dp=2 }       → edit(k, [x,y,z])
//   { t:'text',   k, label, value, placeholder? }                 → edit(k, string)  [desktop only]
//   { t:'btn',    k, label, danger? }                             → edit(k)
//   { t:'list',   label, empty?, rows:[{ id, label, sub?, active?,
//                 actions:[{k, label, danger?}] }] }              → edit(k, rowId) / edit('row', rowId)
//   { t:'check',  k, label, value }                               → edit(k, bool)
//   { t:'enum',   k, label, value, options:[{v,label}] }          → edit(k, v)
//   { t:'color',  k, label, value:0xRRGGBB }                      → edit(k, int)
//   { t:'group',  k, label, open? }   marker: rows until the next marker belong to it;
//                 collapsed groups skip their rows                → edit('fold', k)
//   { t:'tree',   k, rows:[{ id, label, sub?, depth, active?, badges?:[], locked? }] }
//                                                                 → edit(k, id) / edit('lock', id)
// num also takes { unit?, deg? } (deg: value is radians on the wire, degrees
// on the face); vec3 also takes { link? } (one stepper drives all three) and
// reports edit(k, [x,y,z], axisIndex|null) — the third arg is Godot's `field`:
// multi-select assigns one component without clobbering the others.

import { makeFrame } from './frames.js';

// ---------------------------------------------------------------- DOM renderer

export function makeSchemaFrame(key, opts) {
  const frame = makeFrame(key, opts);
  frame.body.classList.add('schema-panel');
  // inner scroller — see .schema-scroll in index.html: a scrollbar on the body
  // itself steals the edge-resize band's pixels
  const scroll = document.createElement('div');
  scroll.className = 'schema-scroll';
  frame.body.append(scroll);
  let lastFields = null, pendingWhileFocused = false;

  function set(fields, edit) {
    lastFields = { fields, edit };
    // Rebuilding under a focused input eats the caret mid-edit; hold the
    // refresh until focus leaves the panel, then paint the queued state.
    if (scroll.contains(document.activeElement) &&
        /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      if (!pendingWhileFocused) {
        pendingWhileFocused = true;
        document.activeElement.addEventListener('blur', () => {
          pendingWhileFocused = false;
          if (lastFields) renderDOM(scroll, lastFields.fields, lastFields.edit);
        }, { once: true });
      }
      return;
    }
    renderDOM(scroll, fields, edit);
  }
  return { frame, set };
}

export function renderDOM(body, fields, edit) {
  body.innerHTML = '';
  let folded = false;
  for (const f of fields) {
    if (f.t === 'group') { folded = f.open === false; body.append(fieldDOM(f, edit)); continue; }
    if (folded) continue;
    body.append(fieldDOM(f, edit));
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const R2D = 180 / Math.PI;
function stepper(value, { step = 0.1, dp = 2, min, max, unit, deg }, commit) {
  const wrap = el('span', 'sp-step');
  const minus = el('button', 'sp-bump', '−');
  const num = el('input', 'sp-num');
  const face = deg ? +value * R2D : +value;
  num.value = face.toFixed(deg ? 0 : dp);
  const plus = el('button', 'sp-bump', '+');
  const clamp = (v) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const send = (v) => commit(deg ? clamp(v) / R2D : clamp(v));
  minus.onclick = () => send(+num.value - step);
  plus.onclick = () => send(+num.value + step);
  num.onchange = () => { const v = parseFloat(num.value); if (Number.isFinite(v)) send(v); };
  wrap.append(minus, num, plus);
  if (unit || deg) wrap.append(el('span', 'sp-unit', deg ? '°' : unit));
  return wrap;
}

function fieldDOM(f, edit) {
  const row = el('div', `sp-row sp-f-${f.t}`);   // sp-f- prefix: never collide with element classes
  if (f.label != null && f.t !== 'btn' && f.t !== 'group') row.append(el('label', 'sp-label', f.label));
  switch (f.t) {
    case 'info': row.append(el('span', 'sp-info', String(f.value ?? ''))); break;
    case 'num':  row.append(stepper(f.value ?? 0, f, (v) => edit(f.k, v))); break;
    case 'vec3': {
      const box = el('span', 'sp-vec');
      const cur = [...(f.value ?? [0, 0, 0])];
      cur.forEach((c, i) => box.append(stepper(c, f, (v) => {
        if (f.link) { edit(f.k, [v, v, v], null); return; }
        const next = [...cur]; next[i] = v; edit(f.k, next, i);
      })));
      row.append(box);
      break;
    }
    case 'enum': {
      const sel = el('select', 'sp-enum');
      for (const o of f.options ?? []) {
        const op = new Option(o.label ?? String(o.v), String(o.v));
        op.selected = o.v === f.value;
        sel.append(op);
      }
      sel.onchange = () => { const o = (f.options ?? []).find((x) => String(x.v) === sel.value); edit(f.k, o ? o.v : sel.value); };
      row.append(sel);
      break;
    }
    case 'color': {
      const inp = el('input', 'sp-color');
      inp.type = 'color';
      inp.value = '#' + (f.value ?? 0xffffff).toString(16).padStart(6, '0');
      inp.onchange = () => edit(f.k, parseInt(inp.value.slice(1), 16));
      row.append(inp);
      break;
    }
    case 'group': {
      row.classList.add(f.open === false ? 'closed' : 'open');
      const h = el('button', 'sp-group', `${f.open === false ? '▸' : '▾'} ${f.label}`);
      h.onclick = () => edit('fold', f.k);
      row.innerHTML = ''; row.append(h);
      break;
    }
    case 'tree': {
      const box = el('div', 'sp-tree');
      if (!f.rows?.length) box.append(el('div', 'sp-empty', f.empty ?? 'nothing here'));
      for (const r of f.rows ?? []) {
        const line = el('div', `sp-item sp-tree-row${r.active ? ' active' : ''}`);
        line.style.paddingLeft = `${7 + (r.depth ?? 0) * 14}px`;
        const main = el('span', 'sp-item-main');
        main.append(el('span', 'sp-item-label', `${r.depth ? '└ ' : ''}${r.label}`));
        if (r.sub || r.badges?.length) main.append(el('span', 'sp-item-sub', [r.sub, ...(r.badges ?? [])].filter(Boolean).join(' · ')));
        main.onclick = () => edit(f.k, r.id);
        line.append(main);
        const lock = el('button', `sp-mini${r.locked ? ' on' : ''}`, r.locked ? '🔒' : '🔓');
        lock.title = r.locked ? 'locked — click to unlock' : 'click to lock in place';
        lock.onclick = (e) => { e.stopPropagation(); edit('lock', r.id); };
        line.append(lock);
        box.append(line);
      }
      row.append(box);
      break;
    }
    case 'text': {
      const inp = el('input', 'sp-text');
      inp.value = f.value ?? '';
      if (f.placeholder) inp.placeholder = f.placeholder;
      inp.onchange = () => edit(f.k, inp.value);
      row.append(inp);
      break;
    }
    case 'btn': {
      const b = el('button', `sp-btn${f.danger ? ' danger' : ''}`, f.label);
      b.onclick = () => edit(f.k);
      row.append(b);
      break;
    }
    case 'check': {
      const inp = el('input');
      inp.type = 'checkbox';
      inp.checked = !!f.value;
      inp.onchange = () => edit(f.k, inp.checked);
      row.append(inp);
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
        main.onclick = () => edit('row', r.id);
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
  accent: '#e8956b', danger: '#e06060', line: '#242b35',
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
      g.fillText(`${tree && r.depth ? '└ ' : ''}${r.label}`.slice(0, 34), pad + 10 + ind, y + rowH * 0.62);
      if (tree && (r.sub || r.badges?.length)) {
        font(11); g.fillStyle = C.label;
        g.fillText([r.sub, ...(r.badges ?? [])].filter(Boolean).join(' · ').slice(0, 40), pad + 10 + ind + Math.min(220, r.label.length * 9 + 14), y + rowH * 0.62);
      }
      regions.push({ x: pad, y, w: width * 0.6, h: rowH, action: tree ? f.parent.k : 'row', payload: r.id });
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
    if (f.label != null) { font(13); g.fillStyle = C.label; g.fillText(f.label, pad, y + rowH * 0.6); }
    const vx = width * 0.34;
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

/** Resolve a UV hit (0..1, v measured from the top) against regions. */
export function hitRegion(regions, canvas, u, v) {
  const x = u * canvas.width, y = v * canvas.height;
  return regions.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
}
