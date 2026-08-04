// scenegraph — the world as a tree, and the scripts that animate it.
//
// Two sections in the world panel:
//
//   🌳 scene    every entity as a row; mounted things indent under their
//               parent, seated bodies show as riders. Click a row → inspector
//               (live pos, provenance, the component bag verbatim) + actions:
//               find, attach (pick a new parent by clicking it), detach,
//               remove. Attach PRESERVES the current world transform — the
//               thing glues where it stands, it never jumps.
//
//   📜 scripts  the behavior runtime made visible: every bound script with
//               its status (running / paused-with-reason), what it's attached
//               to, its timers — and, selected, its live console (the ring
//               world.log() writes to), polled while you watch. This is the
//               debug UI for the scripting tier; agents get the same data via
//               world_debug, this is the human window onto it.
//
// Everything here READS client state and EMITS verbs — no private channel,
// no authority. The server enforces rights; buttons just try.

import { THREE, CONFIG, bus } from './core.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb, requestDebug } from './net.js';
import { makeSection, flashHint } from './ui.js';
import { componentTypes, componentSpec, defaultsFor } from './components.js';
import { logChat } from './chat.js';
import { myState } from './controller.js';

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const _wp = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _fw = new THREE.Vector3();
const worldYawOf = (obj) => {
  obj.getWorldQuaternion(_wq);
  _fw.set(0, 0, 1).applyQuaternion(_wq);
  return Math.atan2(_fw.x, _fw.z);
};

// ============================================================ 🌳 scene

let sceneApi = null;
let sceneBody = null;
let selected = null;       // entity id shown in the inspector
let arming = null;         // child id waiting for a parent click

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

function wireChannelBox(id, root = sceneBody) {
  const cb = root.querySelector('.cb');
  if (!cb) return;
  const commitComp = (type, data) => sendVerb('comp', { id, type, data });

  const xf = cb.querySelector('.cb-xf');
  if (xf) {
    const [x, y, z, yawDeg, scale] = [...xf.querySelectorAll('input')];
    const commitXf = () => sendVerb('place', {
      id,
      pos: [+x.value || 0, +y.value || 0, +z.value || 0],
      yaw: (+yawDeg.value || 0) / DEG,
      scale: +scale.value || 1,
    });
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

function paintScene() {
  if (!sceneBody) return;
  const { roots, kids, riders } = treeData();
  const rows = [];
  const row = (id, depth) => {
    const meta = entityMeta.get(id);
    const short = (meta?.lib ?? meta?.kind ?? '?').split('/').pop().replace('.glb', '')
      .split('_').slice(0, 3).join(' ');
    const badges = badgesFor(id);
    const scripts = behaviorRows.filter((b) => b.attach === id).map((b) => `📜${b.id}`);
    rows.push(`<div class="who-row sg-row" data-id="${esc(id)}" style="cursor:pointer;padding-left:${depth * 14}px;${id === selected ? 'background:rgba(255,255,255,.06)' : ''}">
      <span class="n">${depth ? '└ ' : ''}<b>${esc(id)}</b> <span style="color:var(--dim)">${esc(short)}</span></span>
      <span class="d">${esc([...badges, ...scripts].join(' · '))}</span></div>`);
    for (const r of riders.get(id) ?? []) {
      rows.push(`<div class="who-row" style="padding-left:${(depth + 1) * 14}px"><span class="n">└ 🧍 ${esc(r)}</span></div>`);
    }
    for (const k of kids.get(id) ?? []) row(k, depth + 1);
  };
  for (const id of roots.sort()) row(id, 0);

  let inspector = '';
  if (selected && entities.has(selected)) {
    const obj = entities.get(selected);
    const meta = entityMeta.get(selected);
    const bag = comps.get(selected);
    const pos = obj ? obj.getWorldPosition(_wp) : null;
    inspector = `<div style="border-top:1px solid var(--edge);margin-top:6px;padding-top:6px">
      <div><b>${esc(selected)}</b> <span style="color:var(--dim)">${esc(meta?.lib ?? '')}</span></div>
      <div style="color:var(--dim)">placed by ${esc(meta?.actor ?? '?')} · ${pos ? `at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` : 'loading'}${obj?.userData?.mountedTo ? ` · mounted on ${esc(obj.userData.mountedTo)}` : ''}</div>
      ${channelBox(selected, bag, obj)}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button data-act="find">find</button>
        <button data-act="satchel" title="save to your personal satchel">🎒 save</button>
        <button data-act="attach">${arming === selected ? 'click new parent…' : 'attach to…'}</button>
        ${obj?.userData?.mountedTo ? '<button data-act="detach">detach</button>' : ''}
        <button data-act="remove">remove</button>
      </div></div>`;
  }
  sceneBody.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:2px"><button class="sg-expand" title="open the full edit surface">⛶ full edit</button></div><div class="stack" style="max-height:200px;overflow:auto">${rows.join('') || '<div style="color:var(--dim)">nothing placed yet</div>'}</div>${inspector}`;

  sceneBody.querySelector('.sg-expand')?.addEventListener('click', () => bus.emit('editmode:toggle'));
  for (const el of sceneBody.querySelectorAll('.sg-row')) {
    el.onclick = () => {
      const id = el.dataset.id;
      if (arming && arming !== id) { doAttach(arming, id); arming = null; return; }
      selected = id === selected ? null : id;
      arming = null;
      paintScene();
      bus.emit('sg:select', selected);
    };
  }
  if (selected) wireChannelBox(selected);
  sceneBody.querySelector('[data-act="find"]')?.addEventListener('click', () => {
    const obj = entities.get(selected);
    if (!obj) return;
    const p = obj.getWorldPosition(_wp);
    flashHint(`<b>${esc(selected)}</b> is ${p.distanceTo(myState.pos).toFixed(0)}m away at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`, 5000);
  });
  sceneBody.querySelector('[data-act="satchel"]')?.addEventListener('click', async () => {
    const meta = entityMeta.get(selected);
    if (meta?.lib) (await import('./satchel.js')).satchelAdd(meta.lib);
  });
  sceneBody.querySelector('[data-act="attach"]')?.addEventListener('click', () => {
    arming = arming === selected ? null : selected;
    flashHint(arming ? 'now click the row of its new parent' : 'attach cancelled', 4000);
    paintScene();
  });
  sceneBody.querySelector('[data-act="detach"]')?.addEventListener('click', () => doDetach(selected));
  sceneBody.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
    sendVerb('remove', { id: selected });
    selected = null;
    bus.emit('sg:select', null);
  });
}

/** Attach preserving the CURRENT world transform: compute the child's pose in
 *  the parent's frame and send it as the mount offset — glue, don't teleport.
 *  Exported for /mount — command and panel are the same act. */
export function sceneAttach(childId, parentId, slot) {
  if (slot) {   // a declared socket wins over glue-in-place
    sendVerb('mount', { id: childId, to: parentId, slot });
    return;
  }
  doAttach(childId, parentId);
}
function doAttach(childId, parentId) {
  const child = entities.get(childId);
  const parent = entities.get(parentId);
  if (!child || !parent) return logChat('*', 'both things must be fully loaded');
  if (childId === parentId) return;
  // no cycles: walking up from the parent must not meet the child
  for (let p = parent; p; p = entities.get(p.userData?.mountedTo)) {
    if (p === child) return logChat('*', 'that would mount a thing onto its own cargo');
  }
  const lp = parent.worldToLocal(child.getWorldPosition(_wp.clone()));
  const relYaw = worldYawOf(child) - worldYawOf(parent);
  sendVerb('mount', {
    id: childId, to: parentId,
    offset: [+lp.x.toFixed(3), +lp.y.toFixed(3), +lp.z.toFixed(3)],
    yaw: +relYaw.toFixed(3),
  });
  logChat('*', `${childId} now rides ${parentId} — it moves when ${parentId} moves`);
}

export function sceneDetach(id) { doDetach(id); }
function doDetach(id) {
  const obj = entities.get(id);
  if (!obj) return;
  const p = obj.getWorldPosition(_wp);
  sendVerb('dismount', { id, pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], yaw: +worldYawOf(obj).toFixed(3) });
}

// ============================================================ 📜 scripts

let scriptsApi = null;
let scriptsBody = null;
let behaviorRows = [];     // last roster — also feeds the 📜 badges in the tree
let watching = null;       // behavior id whose console is open
let pollTimer = null;

async function refreshRoster() {
  const r = await requestDebug({ behaviors: true });
  behaviorRows = (r.events ?? []).filter((e) => e.kind === 'behavior');
}

async function paintScripts() {
  if (!scriptsBody) return;
  const rows = behaviorRows.map((b) => {
    const ok = b.status === 'running';
    return `<div class="who-row sg-bhv" data-id="${esc(b.id)}" style="cursor:pointer;${b.id === watching ? 'background:rgba(255,255,255,.06)' : ''}">
      <span class="n">${ok ? '▶' : '⏸'} <b>${esc(b.id)}</b>${b.attach ? ` <span style="color:var(--dim)">on ${esc(b.attach)}</span>` : ''}</span>
      <span class="d">${b.timers ? `${b.timers}⏲ ` : ''}${ok ? '' : 'paused'}</span></div>`;
  });

  let consoleHtml = '';
  if (watching) {
    const d = await requestDebug({ behavior: watching, limit: 40 });
    const lines = (d.events ?? []).map((e) =>
      `${new Date(e.ts).toTimeString().slice(0, 8)} ${esc(e.line)}`).join('\n');
    consoleHtml = `<div style="border-top:1px solid var(--edge);margin-top:6px;padding-top:6px">
      <div><b>${esc(watching)}</b> — <span style="color:${d.status === 'running' ? 'var(--ok, #7c9)' : 'var(--warn, #ea5)'}">${esc(d.status ?? '?')}</span></div>
      <pre style="max-height:150px;overflow:auto;margin:4px 0;font-size:11px;white-space:pre-wrap">${lines || '(console empty — world.log() writes here)'}</pre>
      <div style="display:flex;gap:6px">
        <button data-act="unbind">unbind</button>
      </div></div>`;
  }
  scriptsBody.innerHTML = `<div class="stack">${rows.join('') || '<div style="color:var(--dim)">no scripts bound here — see AGENTS.md §runtime scripts</div>'}</div>${consoleHtml}
    <div style="color:var(--dim);font-size:11px;margin-top:4px">/debug [n] = flight recorder · agents: world_debug</div>`;

  for (const el of scriptsBody.querySelectorAll('.sg-bhv')) {
    el.onclick = () => { watching = el.dataset.id === watching ? null : el.dataset.id; paintScripts(); };
  }
  scriptsBody.querySelector('[data-act="unbind"]')?.addEventListener('click', async () => {
    sendVerb('behavior', { id: watching, remove: true });
    watching = null;
    setTimeout(async () => { await refreshRoster(); paintScripts(); paintScene(); }, 400);
  });
}

/** The dock's ✏️ edit button opens the outliner alongside the build catalog —
 *  one click = edit mode + catalog + scene tree + channel box. */
export function openSceneSection() { sceneApi?.toggle(true).catch(() => {}); }

// ---- shared with the edit surface (editmode.js) ----------------------------
// One selection, two projections: the panel section and the full edit surface
// show the SAME selected entity; whichever changes it emits sg:select.
export { treeData, badgesFor, channelBox, wireChannelBox };
export function sgSelected() { return selected; }
export function sgSelect(id) {
  selected = id;
  if (sceneApi?.isOpen) paintScene();
  bus.emit('sg:select', id);
}

// ============================================================ wiring

export function initSceneGraph() {
  sceneApi = makeSection('🌳 scene', async (body) => {
    sceneBody = body;
    await refreshRoster();      // the tree shows 📜 badges too
    paintScene();
  }, { id: 'scene' });

  scriptsApi = makeSection('📜 scripts', async (body) => {
    scriptsBody = body;
    await refreshRoster();
    await paintScripts();
    clearInterval(pollTimer);
    // live console: poll while the section is open — a script author sits
    // here watching their world.log() arrive, which is the whole point
    pollTimer = setInterval(async () => {
      if (!scriptsApi?.isOpen) { clearInterval(pollTimer); pollTimer = null; return; }
      await refreshRoster();
      await paintScripts();
    }, 2500);
  }, { id: 'scripts' });

  // keep the tree honest while it's visible
  let repaintQueued = false;
  const repaint = () => {
    if (repaintQueued || !sceneApi?.isOpen) return;
    // don't repaint out from under someone mid-edit in the channel box — the
    // commit's own echo repaints after they blur the field
    const a = document.activeElement;
    if (a && sceneBody?.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    repaintQueued = true;
    setTimeout(() => { repaintQueued = false; if (sceneApi?.isOpen) paintScene(); }, 300);
  };
  bus.on('entity', repaint);
  bus.on('comp', repaint);
  bus.on('mount', repaint);
}
