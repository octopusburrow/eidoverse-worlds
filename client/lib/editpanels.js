// editpanels — the hierarchy and the inspector as FIELDS (panels.js), so one
// declaration is a desktop frame and a VR quad. Every action here is a verb
// scenegraph.js already speaks; this file only decides what the rows are.
//
// P1 of notes/proposals/2026-09-04-edit-mode-spec.md, at parity with the
// World›Scene section it retires: transform, lock, every registered component
// editor (inspect.js), raw JSON for the rest, add/remove component, find /
// attach / detach / remove, script badges and a Behaviors group.
//
// The inspector is two lanes, Maya's shape:
//   CHANNELS  every numeric value on the selection in one dense column —
//             pos/yaw/scale plus every `num` a component editor declares.
//             Drag to scrub, click to type, `+=` `*=` math. The fast lane.
//   GROUPS    the full editors: colours, toggles, lists, and the same
//             numbers again next to their meaning. The complete lane.
// A number a motion comp drives shows its REST pose, tinted: `place` moves
// the base the motion composes onto, which is the honest thing to edit.

import { THREE } from './core.js';
import { bus } from './base.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb, requestDebug } from './net.js';
import { flashHint } from './ui.js';
import { makeSchemaFrame } from './panels.js';
import { registerXRPanel } from './xrpanels.js';
import { treeData, sceneSelected, sceneSelect, sceneAttach, sceneDetach } from './scenegraph.js';
import { pushUndo } from './build.js';
import { fieldEditorsFor } from './inspect.js';
import { myState } from './controller.js';
import { reindexCollider } from './colliders.js';

const _wp = new THREE.Vector3();
const short = (meta) => (meta?.lib ?? meta?.kind ?? '?').split('/').pop().replace('.glb', '').split('_').slice(0, 3).join(' ');
const round = (v, dp = 3) => +(+v).toFixed(dp);

// collapsed groups remembered per LIB (a chair's Components stays open for
// every chair) — Godot folds per object; per lib is the eidoverse shape
const FOLD_LS = 'ew-insp-fold';
let folds = {};
try { folds = JSON.parse(localStorage.getItem(FOLD_LS) || '{}'); } catch { /* fresh */ }
const foldKey = (id) => `${entityMeta.get(id)?.lib ?? '?'}`;
const isOpen = (id, g) => !(folds[foldKey(id)]?.[g]);
function toggleFold(id, g) {
  const k = foldKey(id); folds[k] ??= {}; folds[k][g] = !folds[k][g];
  try { localStorage.setItem(FOLD_LS, JSON.stringify(folds)); } catch { /* fine */ }
}
let arming = null;   // 'attach' while waiting for the next selection to become the parent

// ---------------------------------------------------------------- scripts roster
// the behavior runtime, for 📜 badges in the tree and the Behaviors group —
// the same world_debug an agent reads, polled while the panels are up
let behaviors = [];
let shown = false;
let rosterTimer = 0;
async function refreshBehaviors() {
  try {
    const r = await requestDebug({ behaviors: true });
    behaviors = (r?.events ?? []).filter((e) => e.kind === 'behavior');
    repaintAll();
  } catch { /* the roster is a refinement, never a gate */ }
}

function badgesFor(id) {
  const out = [];
  const bag = comps.get(id) ?? {};
  for (const [type, data] of Object.entries(bag)) {
    if (type === 'lock') continue;
    if (type === 'motion' || type.startsWith('motion:')) out.push(`${type}(${data?.type ?? '…'})`);
    else if (type === 'sockets' || type === 'reactions') out.push(`${type}(${Object.keys(data ?? {}).join(',')})`);
    else out.push(type);
  }
  for (const b of behaviors) if (b.attach === id) out.push(`📜${b.id}`);
  return out;
}

// ---------------------------------------------------------------- hierarchy
function hierarchyFields() {
  const { roots, kids, riders } = treeData();
  const sel = sceneSelected();
  const rows = [];
  const walk = (id, depth) => {
    const meta = entityMeta.get(id); const bag = comps.get(id) ?? {};
    const badges = badgesFor(id);
    if (!entities.get(id)) badges.unshift('loading…');
    rows.push({ id, label: id, sub: short(meta), depth, active: id === sel, badges, locked: !!bag.lock });
    for (const r of riders.get(id) ?? []) rows.push({ id: `rider:${r}`, label: `🧍 ${r}`, depth: depth + 1 });
    for (const k of kids.get(id) ?? []) walk(k, depth + 1);
  };
  for (const id of roots.sort()) walk(id, 0);
  const f = [{ t: 'tree', k: 'sel', rows, empty: 'nothing placed yet' }];
  if (sel && entities.has(sel)) {
    f.push({ t: 'btn', k: 'find', label: 'find' });
    f.push({ t: 'btn', k: 'attach', label: arming ? 'click new parent…' : 'attach to…' });
    if (entities.get(sel)?.userData?.mountedTo) f.push({ t: 'btn', k: 'detach', label: 'detach' });
    f.push({ t: 'btn', k: 'remove', label: 'remove', danger: true });
  }
  return f;
}
function hierarchyDispatch(action, payload) {
  const sel = sceneSelected();
  switch (action) {
    case 'sel': {
      if (String(payload).startsWith('rider:')) return;
      if (arming && sel && payload !== sel) { sceneAttach(sel, payload); arming = null; break; }
      sceneSelect(payload);
      break;
    }
    case 'lock': toggleLock(payload); break;
    case 'find': findSelected(); break;
    case 'attach': arming = arming ? null : 'attach'; flashHint(arming ? 'now pick its new parent' : 'attach cancelled', 4000); break;
    case 'detach': if (sel) sceneDetach(sel); break;
    case 'remove': if (sel) removeWithUndo(sel); break;
  }
  repaintAll();
}

function toggleLock(id) {
  const locked = !!comps.get(id)?.lock;
  sendVerb('comp', { id, type: 'lock', data: locked ? null : true });
  pushUndo({ verb: 'comp', args: { id, type: 'lock', data: locked ? true : null } }, locked ? `unlocking ${id}` : `locking ${id}`);
}
function findSelected() {
  const sel = sceneSelected(); const obj = entities.get(sel); if (!obj) return;
  const p = obj.getWorldPosition(_wp);
  flashHint(`<b>${sel}</b> is ${p.distanceTo(myState.pos).toFixed(0)}m away at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`, 5000);
}

// ---------------------------------------------------------------- inspector
let editors = [];      // the registry's claims on the current selection, as painted
let gesture = null;    // { before } while a transform drag is in flight

/** Is a whole-entity motion composing onto this thing's rest pose? */
function drivenBy(id, obj) {
  if (obj?.userData?.mountedTo) return null;
  const bag = comps.get(id) ?? {};
  for (const k in bag) {
    if ((k === 'motion' && bag[k]?.type && !bag[k]?.part) || k.startsWith('motion:')) return k;
  }
  return null;
}
/** The pose `place` edits: the rest pose when a motion drives the object. */
function restPose(obj, driven) {
  const b = driven ? obj.userData.base : null;
  return b
    ? { pos: b.pos.map((v) => round(v)), yaw: round(b.yaw, 4), scale: round(obj.scale?.x ?? 1) }
    : { pos: [round(obj.position.x), round(obj.position.y), round(obj.position.z)], yaw: round(obj.rotation.y, 4), scale: round(obj.scale?.x ?? 1) };
}

function inspectorFields() {
  const id = sceneSelected();
  if (!id || !entities.has(id)) return [{ t: 'info', label: 'selection', value: 'nothing selected — click a thing, or a row in the hierarchy' }];
  const obj = entities.get(id); const meta = entityMeta.get(id) ?? {}; const bag = comps.get(id) ?? {};
  // the fold knows the thing before its model arrives: entities holds null
  // while the GLB loads (scenegraph guards the same seam)
  if (!obj) return [{ t: 'info', label: 'id', value: id }, { t: 'info', label: 'lib', value: short(meta) }, { t: 'info', label: 'state', value: 'loading…' }];
  const isLight = !!obj?.userData?.isLight;
  const locked = !!bag.lock;
  const driven = drivenBy(id, obj);
  const pose = restPose(obj, driven);
  const wp = obj.getWorldPosition(_wp);
  editors = fieldEditorsFor({ id, obj, meta, bag, commit: sendVerb });

  const f = [
    { t: 'info', label: 'id', value: id },
    { t: 'info', label: 'lib', value: short(meta) },
    { t: 'info', label: 'by', value: `${meta.actor ?? '?'}${obj?.userData?.mountedTo ? ` · on ${obj.userData.mountedTo}` : ''}` },
    { t: 'info', label: 'world', value: `(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)}) · ${wp.distanceTo(myState.pos).toFixed(0)}m away` },
  ];

  // CHANNELS — the numeric lane. Transform first (the entity's LOCAL frame,
  // exactly what `place` takes), then every num any editor declared.
  f.push({ t: 'group', k: 'channels', label: `Channels${locked ? ' 🔒' : ''}${obj.userData.mountedTo ? ' (local)' : ''}`, open: isOpen(id, 'channels') });
  const tf = { compact: true, disabled: locked, driven: driven ?? undefined, hint: locked ? 'locked — uncheck lock to move it' : undefined };
  ['x', 'y', 'z'].forEach((ax, i) => f.push({ t: 'num', k: `ch:pos:${i}`, label: `pos ${ax}`, value: pose.pos[i], step: 0.1, dp: 2, unit: 'm', ...tf }));
  if (!isLight) {
    f.push({ t: 'num', k: 'ch:yaw', label: 'yaw', value: pose.yaw, step: 5, deg: true, ...tf });
    f.push({ t: 'num', k: 'ch:scale', label: 'scale', value: pose.scale, step: 0.05, dp: 2, min: 0.01, softMax: 12, ...tf });
  }
  editors.forEach((e, i) => {
    for (const nf of e.fields) {
      if (nf.t !== 'num') continue;
      f.push({ ...nf, k: `ch:${i}:${nf.k}`, label: `${e.group} · ${nf.label ?? nf.k}`, compact: true });
    }
  });

  f.push({ t: 'group', k: 'flags', label: 'Flags', open: isOpen(id, 'flags') });
  f.push({ t: 'check', k: 'lock', label: 'locked', value: locked, hint: 'nail it down: nobody\'s drags, verbs or scripts can move, replace or remove it (server-enforced) — sitting on it and content edits stay open' });

  // GROUPS — one per editor that claimed the selection, then raw JSON for
  // every comp type no editor speaks for (the blind fold's UI twin: a type
  // invented this morning is editable today), then add.
  const claimed = new Set();
  editors.forEach((e, i) => {
    for (const t of e.types ?? []) claimed.add(t);
    f.push({ t: 'group', k: `ed:${e.group}`, label: e.group, open: isOpen(id, `ed:${e.group}`) });
    for (const nf of e.fields) f.push({ ...nf, k: nf.k != null ? `ed:${i}:${nf.k}` : undefined });
  });
  const rest = Object.keys(bag).filter((t) => t !== 'lock' && !claimed.has(t));
  f.push({ t: 'group', k: 'components', label: `Components (${rest.length})`, open: isOpen(id, 'components') });
  for (const type of rest) {
    f.push({ t: 'text', k: `comp:${type}`, label: type, value: JSON.stringify(bag[type]), hint: 'raw JSON — a saved edit replaces this type\'s data wholesale' });
    f.push({ t: 'btn', k: `uncomp:${type}`, label: `remove ${type}`, danger: true });
  }
  f.push({ t: 'text', k: 'newtype', label: '+ component', value: '', placeholder: 'type (sockets, recipe…) ⏎', hint: 'attach a component — any type folds, evaluators give known ones behavior' });

  const mine = behaviors.filter((b) => b.attach === id);
  if (mine.length) {
    f.push({ t: 'group', k: 'behaviors', label: `Behaviors (${mine.length})`, open: isOpen(id, 'behaviors') });
    f.push({ t: 'list', k: 'bhv', rows: mine.map((b) => ({ id: b.id, label: `${b.status === 'running' ? '▶' : '⏸'} ${b.id}`, sub: `${b.timers ? `${b.timers}⏲ ` : ''}${b.status ?? ''}`, actions: [{ k: 'unbind', label: 'unbind', danger: true }] })) });
  }
  f.push({ t: 'btn', k: 'remove', label: 'remove', danger: true });
  return f;
}

function inspectorDispatch(action, payload, field, opts = {}) {
  const id = sceneSelected(); const obj = entities.get(id);
  if (action === 'fold') { toggleFold(id, payload); repaintAll(); return; }
  if (!obj) return;
  const live = !!opts.live;

  // transform channels: preview locally while dragging (no log traffic), one
  // `place` on release carrying the full pose the channels show
  if (action.startsWith('ch:') && /^ch:(pos:\d|yaw|scale)$/.test(action)) {
    const driven = drivenBy(id, obj);
    const before = gesture?.before ?? restPose(obj, driven);
    const next = { ...before, pos: [...before.pos] };
    // canvas steppers send {axis, delta}; DOM sends the whole value
    const val = (cur) => (typeof payload === 'object' && payload && 'delta' in payload ? cur + payload.delta : payload);
    if (action.startsWith('ch:pos:')) { const i = +action.slice(7); next.pos[i] = round(val(before.pos[i])); }
    else if (action === 'ch:yaw') next.yaw = round(val(before.yaw), 4);
    else next.scale = Math.max(0.01, round(val(before.scale)));
    if (next.pos.some(Number.isNaN)) return;
    if (live) {
      gesture ??= { before };
      if (!driven) {   // a driven thing can't preview: the motion owns the frame
        obj.position.set(...next.pos); obj.rotation.y = next.yaw; obj.scale.setScalar(next.scale);
        reindexCollider(id);
      }
      return;
    }
    gesture = null;
    if (JSON.stringify(next) === JSON.stringify(before)) return;
    pushUndo({ verb: 'place', args: { id, ...before } }, `moving ${id}`);
    sendVerb('place', { id, ...next });
    repaintAll();
    return;
  }
  // an editor's field, from either lane: ch:<i>:<k> or ed:<i>:<k>
  const m = /^(ch|ed):(\d+):(.+)$/.exec(action);
  if (m) {
    const e = editors[+m[2]];
    try { e?.dispatch(m[3], payload, field, opts); } catch (err) { flashHint(`editor error: ${err.message}`, 5000); }
    if (!live) repaintAll();
    return;
  }
  switch (action) {
    case 'lock': toggleLock(id); break;
    case 'remove': removeWithUndo(id); break;
    case 'unbind': sendVerb('behavior', { id: payload, remove: true }); setTimeout(refreshBehaviors, 400); break;
    case 'newtype': {
      const type = String(payload ?? '').trim();
      if (!type) return;
      if (comps.get(id)?.[type] != null) { flashHint(`${id} already has ${type}`, 4000); return; }
      pushUndo({ verb: 'comp', args: { id, type, data: null } }, `adding ${type} to ${id}`);
      sendVerb('comp', { id, type, data: {} });
      break;
    }
    default: {
      if (action.startsWith('comp:')) {
        const type = action.slice(5); let data;
        try { data = JSON.parse(payload); } catch (err) { flashHint(`not valid JSON: ${err.message}`, 5000); return; }
        pushUndo({ verb: 'comp', args: { id, type, data: comps.get(id)?.[type] ?? null } }, `editing ${type} on ${id}`);
        sendVerb('comp', { id, type, data });
      } else if (action.startsWith('uncomp:')) {
        const type = action.slice(7);
        pushUndo({ verb: 'comp', args: { id, type, data: comps.get(id)?.[type] ?? null } }, `removing ${type} from ${id}`);
        sendVerb('comp', { id, type, data: null });
      }
    }
  }
  repaintAll();
}

function removeWithUndo(id) {
  const obj = entities.get(id); const meta = entityMeta.get(id) ?? {};
  if (!obj) return;
  if (comps.get(id)?.lock) { flashHint(`${id} is locked — unlock it first`, 4000); return; }
  const pose = restPose(obj, drivenBy(id, obj));
  pushUndo({ verb: 'spawn', args: { id, lib: meta.lib, ...pose } }, `removing ${id}`);
  sendVerb('remove', { id });
}

// ---------------------------------------------------------------- mounting
const PANELS = [
  { id: 'hierarchy', title: 'Hierarchy', fields: hierarchyFields, dispatch: hierarchyDispatch, frame: { x: 64, y: 60, w: 300, h: 380, minW: 220, minH: 160 } },   // x clears the dock rail (left:10 + 34px buttons + padding)
  { id: 'inspector', title: 'Inspector', fields: inspectorFields, dispatch: inspectorDispatch, frame: { x: -330, y: 60, w: 320, h: 520, minW: 250, minH: 160 } },
];
const frames = new Map();
let queued = false;
function repaintAll() {
  globalThis.__panelTrace?.push(['ask', performance.now() | 0, queued]);   // probe hook; inert otherwise
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    globalThis.__panelTrace?.push(['paint', performance.now() | 0]);
    for (const p of PANELS) frames.get(p.id)?.set(p.fields(), (a, v, fld, o) => p.dispatch(a, v, fld, o));
    bus.emit('xr:repaint');
  });
}

export function initEditPanels() {
  for (const p of PANELS) {
    registerXRPanel(p);                                   // the VR body
    const sf = makeSchemaFrame(p.id, { title: p.title, ...p.frame, hidden: true, className: 'edit' });   // the desktop body
    frames.set(p.id, sf);
  }
  for (const ev of ['entity', 'comp', 'mount', 'edit-mode', 'sg:selected']) bus.on(ev, repaintAll);
  bus.on('sg:selected', () => { if (shown) refreshBehaviors(); });
  repaintAll();
  globalThis.__editPanels = editPanelsDebug;   // harness window (probes read it, nothing else does)
  const show = (on) => {
    shown = !!on;
    for (const sf of frames.values()) on ? sf.frame.show() : sf.frame.hide();
    clearInterval(rosterTimer); rosterTimer = 0;
    if (on) { refreshBehaviors(); rosterTimer = setInterval(refreshBehaviors, 5000); }
  };
  return { show };
}

/** harness window */
export const editPanelsDebug = () => ({
  hierarchy: hierarchyFields().length, inspector: inspectorFields().length, selected: sceneSelected(), arming,
  editors: editors.map((e) => e.group), behaviors: behaviors.length,
});
