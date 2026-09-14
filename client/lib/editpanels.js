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
import { makeSchemaFrame, resolveDelta } from './panels.js';
import { registerXRPanel } from './xrpanels.js';
import { treeData, sceneSelected, sceneSelect, sceneAttach, sceneDetach } from './scenegraph.js';
import { pushUndo, refreshOutline } from './build.js';
import { schemaFor, commitEdit, setEditHooks, endGesture, foldRecord } from './inspect.js';
import { channels } from '../../shared/editschema.js';
import { commitLight, lightCasting } from './lights.js';
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
let arming = null;   // the child id waiting for a row click to name its parent

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
  // no button row: a row's actions live on its right-click menu (and the
  // keys — F find, Del remove); the tree is the tree
  for (const r of rows) {
    if (String(r.id).startsWith('rider:')) continue;
    const mounted = !!entities.get(r.id)?.userData?.mountedTo;
    r.menu = [
      { k: 'find', label: 'find  (F)' },
      { k: 'attach', label: arming === r.id ? 'cancel attach' : 'attach to…' },
      ...(mounted ? [{ k: 'detach', label: 'detach' }] : []),
      { k: 'lock', label: r.locked ? 'unlock' : 'lock in place' },
      { k: 'remove', label: 'remove  (Del)', danger: true },
    ];
  }
  return [{ t: 'tree', k: 'sel', rows, empty: 'nothing placed yet — press B in the world to place things' }];
}
function hierarchyDispatch(action, payload) {
  let sel = sceneSelected();
  switch (action) {
    case 'sel': {
      if (String(payload).startsWith('rider:')) return;
      if (arming && payload !== arming) { sceneAttach(arming, payload); arming = null; break; }
      sceneSelect(payload);
      break;
    }
    case 'lock': toggleLock(payload); break;
    // menu items act on the row they were opened on: select it first
    case 'find': if (payload && payload !== sel) sceneSelect(payload); findSelected(); break;
    case 'attach': {
      if (arming === payload) { arming = null; flashHint('attach cancelled', 3000); break; }
      arming = payload ?? sel;
      if (arming) { sceneSelect(arming); flashHint(`now click the row of <b>${arming}</b>'s new parent`, 5000); }
      break;
    }
    case 'detach': sceneDetach(payload ?? sel); break;
    case 'remove': if (payload ?? sel) removeWithUndo(payload ?? sel); break;
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
let painted = [];      // the inspector's last field list (a canvas stepper's delta resolves against it)
let gesture = null;    // { before } while a transform drag is in flight (the local preview's start pose)

/** Is a whole-entity motion composing onto this thing's rest pose? */
function drivenBy(id, obj) {
  if (obj?.userData?.mountedTo) return null;
  const m = comps.get(id)?.motion;
  return m?.type && !m.part ? 'motion' : null;
}
/** The pose `place` edits — the FOLD's, which is the rest pose by definition. */
function restPose(id, obj) {
  const rec = foldRecord(id);
  return rec
    ? { pos: (rec.pos ?? [0, 0, 0]).map((v) => round(v)), yaw: round(rec.yaw ?? 0, 4), scale: round(rec.scale ?? 1) }
    : { pos: [round(obj.position.x), round(obj.position.y), round(obj.position.z)], yaw: round(obj.rotation.y, 4), scale: round(obj.scale?.x ?? 1) };
}

function inspectorFields() {
  const id = sceneSelected();
  if (!id || !entities.has(id)) return [{ t: 'info', label: 'selection', value: 'nothing selected — click a thing, or a row in the hierarchy' }];
  const obj = entities.get(id); const meta = entityMeta.get(id) ?? {}; const bag = comps.get(id) ?? {};
  // the fold knows the thing before its model arrives: entities holds null
  // while the GLB loads (scenegraph guards the same seam)
  if (!obj) return [{ t: 'info', label: 'id', value: id }, { t: 'info', label: 'lib', value: short(meta) }, { t: 'info', label: 'state', value: 'loading…' }];
  const schema = schemaFor(id);           // ONE declaration: shared/editschema.js
  const locked = !!bag.lock;
  const wp = obj.getWorldPosition(_wp);
  const label = typeof bag.label === 'string' && bag.label ? ` "${bag.label}"` : '';

  const f = [
    { t: 'info', label: 'id', value: `${id}${label}` },
    { t: 'info', label: 'lib', value: short(meta) },
    { t: 'info', label: 'by', value: `${meta.actor ?? '?'}${obj?.userData?.mountedTo ? ` · on ${obj.userData.mountedTo}` : ''}` },
    { t: 'info', label: 'world', value: `(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}, ${wp.z.toFixed(1)}) · ${wp.distanceTo(myState.pos).toFixed(0)}m away` },
  ];

  // CHANNELS — the numeric lane: every num in the schema, transform first
  f.push({ t: 'group', k: 'channels', label: `Channels${locked ? ' 🔒' : ''}${obj.userData.mountedTo ? ' (mounted)' : ''}`, open: isOpen(id, 'channels') });
  for (const c of channels(schema)) {
    f.push({ ...c, k: `ch:${c.key}`, label: c.group === 'pos' ? c.label : `${c.group} · ${c.label ?? c.k}`, compact: true });
  }

  // GROUPS — flags, then every component group the schema declares, then the
  // raw-JSON floor for types no group speaks for, then behaviors
  const groupOf = (name) => schema.groups.find((g) => g.group === name);
  const addGroup = (g, key, title) => {
    if (!g) return;
    f.push({ t: 'group', k: `g:${key}`, label: title ?? g.label ?? g.group, open: isOpen(id, `g:${key}`) });
    for (const nf of g.fields) {
      const row = { ...nf, k: nf.k != null ? `ed:${g.group}.${nf.k}` : undefined };
      if (nf.t === 'list') row.rows = (nf.rows ?? []).map((r) => ({ ...r, actions: (r.actions ?? []).map((a) => ({ ...a, k: `ed:${g.group}.${a.k}` })) }));
      if (nf.t === 'text' && g.group === 'comp' && nf.k !== '+') { f.push(row); f.push({ t: 'btn', k: `uncomp:${nf.k}`, label: `remove ${nf.k}`, danger: true }); continue; }
      f.push(row);
    }
  };
  addGroup(groupOf('flags'), 'flags', 'Flags');
  for (const g of schema.groups) if (!['pos', 'flags', 'comp'].includes(g.group)) addGroup(g, g.group);
  addGroup(groupOf('comp'), 'components');

  const mine = behaviors.filter((b) => b.attach === id);
  if (mine.length) {
    f.push({ t: 'group', k: 'behaviors', label: `Behaviors (${mine.length})`, open: isOpen(id, 'behaviors') });
    f.push({ t: 'list', k: 'bhv', rows: mine.map((b) => ({ id: b.id, label: `${b.status === 'running' ? '▶' : '⏸'} ${b.id}`, sub: `${b.timers ? `${b.timers}⏲ ` : ''}${b.status ?? ''}`, actions: [{ k: 'unbind', label: 'unbind', danger: true }] })) });
  }
  f.push({ t: 'btn', k: 'remove', label: 'remove', danger: true });
  painted = f;
  return f;
}

function inspectorDispatch(action, payload, field, opts = {}) {
  const id = sceneSelected(); const obj = entities.get(id);
  if (action === 'fold') { toggleFold(id, payload); repaintAll(); return; }
  if (!obj) return;
  const live = !!opts.live;

  // transform channels: preview locally while dragging (no log traffic), one
  // `place` on release carrying the full pose the channels show
  if (/^ch:pos\.(x|y|z|yaw|scale)$/.test(action)) {
    const k = action.slice(7);
    const driven = drivenBy(id, obj);
    const before = gesture?.before ?? restPose(id, obj);
    const next = { ...before, pos: [...before.pos] };
    const val = (cur) => (typeof payload === 'object' && payload && 'delta' in payload ? cur + payload.delta : payload);
    if (k === 'yaw') next.yaw = round(val(before.yaw), 4);
    else if (k === 'scale') next.scale = Math.max(0.01, round(val(before.scale)));
    else next.pos['xyz'.indexOf(k)] = round(val(before.pos['xyz'.indexOf(k)]));
    if (next.pos.some(Number.isNaN)) return;
    if (live) {
      // a live call back AT the start pose is a cancelled/no-op drag ending
      if (JSON.stringify(next) === JSON.stringify(before)) gesture = null; else gesture ??= { before };
      if (!driven) {   // a driven thing can't preview: the motion owns the frame
        obj.position.set(...next.pos); obj.rotation.y = next.yaw; obj.scale.setScalar(next.scale);
        reindexCollider(id); refreshOutline();
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
  // every other field, from either lane: ch:<group.k> / ed:<group.k> → the shared commit path
  if (action.startsWith('ch:') || action.startsWith('ed:')) {
    const key = action.slice(3);
    const isDelta = typeof payload === 'object' && payload && 'delta' in payload;   // a VR stepper
    const v = isDelta ? resolveDelta(painted, action, payload) : payload;
    if (isDelta && v == null) return;
    const r = commitEdit(id, key, v, opts);
    if (r.errors?.length) flashHint(r.errors.join(' · '), 5000);
    if (!live) repaintAll();
    return;
  }
  switch (action) {
    case 'remove': removeWithUndo(id); break;
    case 'unbind': sendVerb('behavior', { id: payload, remove: true }); setTimeout(refreshBehaviors, 400); break;
    default: if (action.startsWith('uncomp:')) commitEdit(id, `comp.${action.slice(7)}`, null);
  }
  repaintAll();
}

function removeWithUndo(id) {
  const obj = entities.get(id); const meta = entityMeta.get(id) ?? {};
  if (!obj) return;
  if (comps.get(id)?.lock) { flashHint(`${id} is locked — unlock it first`, 4000); return; }
  const pose = restPose(id, obj);
  const lp = obj.userData.isLight ? obj.userData.lightParams ?? {} : null;
  pushUndo(lp
    ? { verb: 'light', args: { id, pos: pose.pos, color: lp.color, intensity: lp.intensity, range: lp.range, keep: !!lp.keep, day: lp.day !== false } }
    : { verb: 'spawn', args: { id, lib: meta.lib, ...pose } }, `removing ${id}`);
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
  bus.on('sg:selected', () => { gesture = null; endGesture(); });   // a drag's `before` never outlives its selection
  setEditHooks({ undo: pushUndo, commitLight, casting: lightCasting });
  bus.on('edit-find', () => findSelected());              // F in the viewport
  bus.on('sg:selected', () => { if (shown) refreshBehaviors(); });
  repaintAll();
  globalThis.__editPanels = editPanelsDebug;   // harness window (probes read it, nothing else does)
  import('./editlayout.js').then((m) => { globalThis.__editLayout = m.editLayoutDebug; });
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
