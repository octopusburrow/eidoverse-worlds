// editpanels — the hierarchy and the inspector as FIELDS (panels.js), so one
// declaration is a desktop frame and a VR quad. Every action here is a verb
// scenegraph.js already speaks; this file only decides what the rows are.
// P0 of notes/proposals/2026-09-04-edit-mode-spec.md: parity with the World›
// Scene section (pos / yaw / uniform scale, lock, comps, attach/detach/
// remove), no protocol change. rot/per-axis scale/name/hidden wait on P1.

import { THREE } from './core.js';
import { bus } from './base.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb } from './net.js';
import { flashHint } from './ui.js';
import { makeSchemaFrame } from './panels.js';
import { registerXRPanel } from './xrpanels.js';
import { treeData, sceneSelected, sceneSelect, sceneAttach, sceneDetach } from './scenegraph.js';
import { pushUndo } from './build.js';

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

// ---------------------------------------------------------------- hierarchy
function hierarchyFields() {
  const { roots, kids, riders } = treeData();
  const sel = sceneSelected();
  const rows = [];
  const walk = (id, depth) => {
    const meta = entityMeta.get(id); const bag = comps.get(id) ?? {};
    const badges = Object.keys(bag).filter((t) => t !== 'lock');
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
    case 'lock': {
      const locked = !!comps.get(payload)?.lock;
      sendVerb('comp', { id: payload, type: 'lock', data: locked ? null : true });
      pushUndo({ verb: 'comp', args: { id: payload, type: 'lock', data: locked ? true : null } }, locked ? `unlocking ${payload}` : `locking ${payload}`);
      break;
    }
    case 'find': {
      const obj = entities.get(sel); if (!obj) return;
      const p = obj.getWorldPosition(_wp);
      flashHint(`<b>${sel}</b> at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`, 5000);
      break;
    }
    case 'attach': arming = arming ? null : 'attach'; flashHint(arming ? 'now pick its new parent' : 'attach cancelled', 4000); break;
    case 'detach': if (sel) sceneDetach(sel); break;
    case 'remove': if (sel) removeWithUndo(sel); break;
  }
  repaintAll();
}

// ---------------------------------------------------------------- inspector
function inspectorFields() {
  const id = sceneSelected();
  if (!id || !entities.has(id)) return [{ t: 'info', label: 'selection', value: 'nothing selected — click a thing, or a row in the hierarchy' }];
  const obj = entities.get(id); const meta = entityMeta.get(id) ?? {}; const bag = comps.get(id) ?? {};
  const isLight = !!obj?.userData?.isLight;
  const locked = !!bag.lock;
  const f = [
    { t: 'info', label: 'id', value: id },
    { t: 'info', label: 'lib', value: short(meta) },
    { t: 'info', label: 'by', value: `${meta.actor ?? '?'}${obj?.userData?.mountedTo ? ` · on ${obj.userData.mountedTo}` : ''}` },
    { t: 'group', k: 'transform', label: `Transform${locked ? ' 🔒' : ''}${obj?.userData?.mountedTo ? ' (local)' : ''}`, open: isOpen(id, 'transform') },
    { t: 'vec3', k: 'pos', label: 'pos', value: [round(obj.position.x), round(obj.position.y), round(obj.position.z)], step: 0.1, dp: 2, unit: 'm' },
  ];
  if (!isLight) {
    f.push({ t: 'num', k: 'yaw', label: 'yaw', value: round(obj.rotation.y, 4), step: 5, deg: true });
    f.push({ t: 'num', k: 'scale', label: 'scale', value: round(obj.scale?.x ?? 1), step: 0.05, dp: 2, min: 0.01 });
  }
  f.push({ t: 'group', k: 'flags', label: 'Flags', open: isOpen(id, 'flags') });
  f.push({ t: 'check', k: 'lock', label: 'locked', value: locked });
  f.push({ t: 'group', k: 'components', label: `Components (${Object.keys(bag).filter((t) => t !== 'lock').length})`, open: isOpen(id, 'components') });
  for (const [type, data] of Object.entries(bag)) {
    if (type === 'lock') continue;
    // meaning-free rows (the blind fold's UI twin): JSON on desktop, a
    // summary in VR; per-type editors (sockets, motion, light) are P0's
    // next commit — they register into the same field list
    f.push({ t: 'text', k: `comp:${type}`, label: type, value: JSON.stringify(data) });
    f.push({ t: 'btn', k: `uncomp:${type}`, label: `remove ${type}`, danger: true });
  }
  f.push({ t: 'btn', k: 'remove', label: 'remove', danger: true });
  return f;
}
function inspectorDispatch(action, payload, field) {
  const id = sceneSelected(); const obj = entities.get(id);
  if (action === 'fold') { toggleFold(id, payload); repaintAll(); return; }
  if (!obj) return;
  const before = { id, pos: [round(obj.position.x), round(obj.position.y), round(obj.position.z)], yaw: round(obj.rotation.y, 4), scale: round(obj.scale?.x ?? 1) };
  const place = (patch, what) => {
    const args = { ...before, ...patch };
    if (args.pos.some(Number.isNaN)) return;
    pushUndo({ verb: 'place', args: before }, what);
    sendVerb('place', args);
  };
  // canvas steppers send {axis, delta}; DOM sends the whole value
  const bump = (cur, p) => (typeof p === 'object' && p && 'delta' in p ? cur + p.delta : p);
  switch (action) {
    case 'pos': {
      let pos;
      if (typeof payload === 'object' && payload && 'delta' in payload) {
        pos = [...before.pos]; const i = payload.axis ?? 0; pos[i] = round(pos[i] + payload.delta);
      } else pos = payload.map((v) => round(v));
      place({ pos }, `moving ${id}`); break;
    }
    case 'yaw': place({ yaw: round(bump(before.yaw, payload), 4) }, `turning ${id}`); break;
    case 'scale': place({ scale: Math.max(0.01, round(bump(before.scale, payload))) }, `scaling ${id}`); break;
    case 'lock': {
      const locked = !!comps.get(id)?.lock;
      sendVerb('comp', { id, type: 'lock', data: locked ? null : true });
      pushUndo({ verb: 'comp', args: { id, type: 'lock', data: locked ? true : null } }, locked ? `unlocking ${id}` : `locking ${id}`);
      break;
    }
    case 'remove': removeWithUndo(id); break;
    default: {
      if (action.startsWith('comp:')) {
        const type = action.slice(5); let data;
        try { data = JSON.parse(payload); } catch (e) { flashHint(`not valid JSON: ${e.message}`, 5000); return; }
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
  pushUndo({ verb: 'spawn', args: { id, lib: meta.lib, pos: [round(obj.position.x), round(obj.position.y), round(obj.position.z)], yaw: round(obj.rotation.y, 4), scale: round(obj.scale?.x ?? 1) } }, `removing ${id}`);
  sendVerb('remove', { id });
}

// ---------------------------------------------------------------- mounting
const PANELS = [
  { id: 'hierarchy', title: 'hierarchy', fields: hierarchyFields, dispatch: hierarchyDispatch, frame: { x: 10, y: 60, w: 300, h: 360, minW: 220, minH: 160 } },
  { id: 'inspector', title: 'inspector', fields: inspectorFields, dispatch: inspectorDispatch, frame: { x: -320, y: 60, w: 310, h: 420, minW: 240, minH: 160 } },
];
const frames = new Map();
let queued = false;
function repaintAll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const p of PANELS) frames.get(p.id)?.set(p.fields(), (a, v, fld) => p.dispatch(a, v, fld));
    bus.emit('xr:repaint');
  });
}

export function initEditPanels() {
  for (const p of PANELS) {
    registerXRPanel(p);                                   // the VR body
    const sf = makeSchemaFrame(p.id, { title: p.title, ...p.frame, hidden: true });   // the desktop body
    frames.set(p.id, sf);
  }
  for (const ev of ['entity', 'comp', 'mount', 'edit-mode', 'sg:selected']) bus.on(ev, repaintAll);
  repaintAll();
  return { show: (on) => { for (const sf of frames.values()) on ? sf.frame.show() : sf.frame.hide(); } };
}

/** harness window */
export const editPanelsDebug = () => ({
  hierarchy: hierarchyFields().length, inspector: inspectorFields().length, selected: sceneSelected(), arming,
});
