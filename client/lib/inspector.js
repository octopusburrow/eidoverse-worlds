// inspector — their 🌳 inline inspector, EXACTLY, as its own panel.
//
// R (18:47): "the ONLY differences should be the addition of full
// pos/rot/scale XYZ and 'add component' below that. Everything else the
// same, and we'll start triaging."
//
// So, theirs feature-for-feature:
//   · header: id + lib
//   · provenance: placed by · live world position · mounted-on
//   · the component bag, verbatim (one row per comp, data shown raw)
//   · actions: find / attach to… / detach (when mounted) / remove
// Plus exactly two additions:
//   · vec3 steppers for position / rotation / scale (after provenance)
//   · add component (type + JSON data + button), directly below TRS
// Removed in this pass (triage later, deliberately): rename, the grab
// shortcut button, per-comp strip buttons. Stripping still works: add the
// comp type with data `null`.
//
// Writes go through the same verbs agents use (place / comp / remove /
// mount / dismount) — the panel is a hand, not a back door. Every edit
// speaks an undo PAIR (editundo): the inverse sentence rides with it.

import { THREE, bus, report } from './core.js';
import { entities, entityMeta, comps } from './world.js';
import { sendVerb } from './net.js';
import { makeSchemaFrame } from './panels.js';
import { recordPair } from './editundo.js';
import { sceneDetach } from './scenegraph.js';
import { armAttach, armedChild } from './manifest.js';
import { flashHint } from './ui.js';
import { myState } from './controller.js';

let ui = null, currentId = null;
const _wp = new THREE.Vector3();

export function buildFields(id) {
  if (!id || !entities.get(id)) {
    return [{ t: 'info', label: 'selection', value: 'select a thing in edit mode' }];
  }
  const obj = entities.get(id);
  const meta = entityMeta.get(id) ?? {};
  const bag = comps.get(id) ?? {};
  const pos = obj.getWorldPosition(_wp);
  const mountedTo = obj.userData?.mountedTo;
  return [
    // ---- theirs: header + provenance
    { t: 'info', label: 'thing', value: `${id} · ${meta.lib ?? meta.kind ?? '?'}` },
    { t: 'info', label: 'by', value: `placed by ${meta.actor ?? '?'} · at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})${mountedTo ? ` · mounted on ${mountedTo}` : ''}` },
    // ---- addition 1: full TRS
    { t: 'vec3', k: 'pos', label: 'position', value: obj.position.toArray(), step: 0.1, dp: 2 },
    { t: 'vec3', k: 'rot', label: 'rotation°', value: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => r * 180 / Math.PI), step: 15, dp: 0 },
    { t: 'vec3', k: 'scale', label: 'scale', value: obj.scale.toArray(), step: 0.1, dp: 2 },
    // ---- addition 2: add component, directly below TRS
    { t: 'text', k: 'comp-type', label: 'add comp', value: _draft.type, placeholder: 'type e.g. spin' },
    { t: 'text', k: 'comp-data', label: 'data', value: _draft.data, placeholder: '{} (JSON · null strips)' },
    { t: 'btn', k: 'comp-add', label: 'add component' },
    // ---- theirs: the bag, verbatim
    {
      t: 'list', label: 'components', empty: 'no components',
      rows: Object.entries(bag).map(([type, data]) => ({
        id: `comp:${type}`, label: type,
        sub: JSON.stringify(data),
        actions: [],
      })),
    },
    // ---- theirs: the action row
    { t: 'btn', k: 'find', label: 'find' },
    { t: 'btn', k: 'attach', label: armedChild() === id ? 'click new parent…' : 'attach to…' },
    ...(mountedTo ? [{ t: 'btn', k: 'detach', label: 'detach' }] : []),
    { t: 'btn', k: 'remove', label: 'remove', danger: true },
  ];
}

const _draft = { type: '', data: '' };

// Every edit goes out as a PAIR: the sentence that undoes it and the sentence
// itself (editundo speaks the inverse — there is no shadow state to roll back,
// because the edit was always a verb in the log).
function speak(verb, args, inverse) {
  recordPair({ verb, args: inverse }, { verb, args });
  sendVerb(verb, args);
}
const trs = (obj) => ({
  pos: obj.position.toArray().map((n) => +n.toFixed(3)),
  rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((n) => +n.toFixed(4)),
  scale: obj.scale.toArray().map((n) => +n.toFixed(3)),
});

export function dispatch(id, k, v) {
  const obj = entities.get(id);
  if (!obj) return;
  switch (k) {
    case 'pos': {
      const p = (typeof v === 'object' && 'delta' in v)
        ? obj.position.toArray().map((c, i) => (i === v.axis ? c + v.delta : c)) : v;
      speak('place', { id, pos: p }, { id, ...trs(obj) });
      break;
    }
    case 'rot': {
      const cur = [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => r * 180 / Math.PI);
      const deg = (typeof v === 'object' && 'delta' in v)
        ? cur.map((c, i) => (i === v.axis ? c + v.delta : c)) : v;
      speak('place', { id, rot: deg.map((d) => d * Math.PI / 180) }, { id, ...trs(obj) });
      break;
    }
    case 'scale': {
      const cur = obj.scale.toArray();
      const s = ((typeof v === 'object' && 'delta' in v)
        ? cur.map((c, i) => (i === v.axis ? c + v.delta : c)) : v).map((c) => Math.max(0.01, c));
      speak('place', { id, scale: s }, { id, ...trs(obj) });
      break;
    }
    case 'comp-type': _draft.type = v; break;
    case 'comp-data': _draft.data = v; break;
    case 'comp-add': {
      const type = _draft.type.trim().slice(0, 32);
      if (!type) break;
      let data = {};
      if (_draft.data.trim()) {
        try { data = JSON.parse(_draft.data); }
        catch { report('comp data', new Error('not valid JSON')); return; }
      }
      const prev = structuredClone(comps.get(id)?.[type] ?? null);
      speak('comp', { id, type, data }, { id, type, data: prev });
      _draft.type = ''; _draft.data = '';
      break;
    }
    // ---- their actions
    case 'find': {
      const p = obj.getWorldPosition(_wp);
      flashHint(`<b>${id}</b> is ${p.distanceTo(myState.pos).toFixed(0)}m away at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`, 5000);
      break;
    }
    case 'attach': armAttach(id); break;    // next manifest row click = new parent
    case 'detach': sceneDetach(id); break;
    case 'remove': {
      // Their remove, plus the undo pair ours already spoke: the inverse of
      // `remove` is the `spawn` that put it there, its transform, and every
      // component it wore.
      const meta = entityMeta.get(id);
      if (meta?.lib) {
        const worn = Object.entries(comps.get(id) ?? {})
          .map(([type, data]) => ({ verb: 'comp', args: { id, type, data: structuredClone(data) } }));
        recordPair(
          { verb: 'spawn', args: { id, lib: meta.lib, pos: obj.position.toArray(), yaw: obj.rotation.y },
            also: [
              { verb: 'place', args: { id, rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z], scale: obj.scale.toArray() } },
              ...worn,
            ] },
          { verb: 'remove', args: { id } });
      }
      sendVerb('remove', { id });
      break;
    }
  }
}

function paint() {
  ui?.set(buildFields(currentId), (k, v) => { dispatch(currentId, k, v); paint(); });
}

export function initInspector() {
  ui = makeSchemaFrame('inspector', {
    // y: 52 clears the top bar — 40 tucked under it and ate the edit button,
    // trapping R in edit mode with no way to click out (found live 00:12).
    // x offset from the right EDGE avoids the world/present stack at -10.
    title: 'inspector', x: -252, y: 52, w: 320, h: 420, minW: 260, minH: 200,
  });
  ui.frame.hide();
  bus.on('ws:select', (id) => { currentId = id; paint(); });
  bus.on('entity', ({ id }) => { if (id === currentId) paint(); });
  bus.on('comp', ({ id }) => { if (id === currentId) paint(); });
  bus.on('mount', () => paint());
  bus.on('ws:open', (on) => { on ? ui.frame.show() : ui.frame.hide(); });
  paint();
}

export const inspectorFields = () => buildFields(currentId);
export const inspectorDispatch = (k, v) => { dispatch(currentId, k, v); };
