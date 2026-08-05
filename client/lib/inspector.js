// inspector — the right hand (R, 21:56): everything about ONE selected thing.
// TRS as steppers, components as a list you can add to and strip from. This is
// the grabbables on-ramp: `grab` is just a comp, so "make grabbable" is the
// panel's most honored button, not a special system.
//
// Writes go through the same verbs agents use (place / comp) — the panel is a
// hand, not a back door. Schema lives in buildFields() so the VR renderer
// paints the identical panel from the identical data.

import { bus, report } from './core.js';
import { entities, entityMeta, comps } from './world.js';
import { sendVerb } from './net.js';
import { makeSchemaFrame } from './panels.js';
import { recordPair } from './editundo.js';

let ui = null, currentId = null;

const label = (id) => {
  const named = comps.get(id)?.label?.text;
  if (named) return named;
  const lib = entityMeta.get(id)?.lib;
  return lib?.split('/').pop()?.replace(/\.(glb|vrm)$/, '') ?? id;
};

export function buildFields(id) {
  if (!id || !entities.get(id)) {
    return [{ t: 'info', label: 'selection', value: 'select a thing in edit mode' }];
  }
  const obj = entities.get(id);
  const meta = entityMeta.get(id) ?? {};
  const bag = comps.get(id) ?? {};
  const grabbable = !!bag.grab;
  return [
    { t: 'info', label: 'thing', value: label(id) },
    { t: 'info', label: 'by', value: meta.actor ?? '?' },
    { t: 'text', k: 'rename', label: 'name', value: bag.label?.text ?? '', placeholder: label(id) },
    { t: 'vec3', k: 'pos', label: 'position', value: obj.position.toArray(), step: 0.1, dp: 2 },
    { t: 'vec3', k: 'rot', label: 'rotation°', value: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => r * 180 / Math.PI), step: 15, dp: 0 },
    { t: 'vec3', k: 'scale', label: 'scale', value: obj.scale.toArray(), step: 0.1, dp: 2 },
    { t: 'btn', k: grabbable ? 'ungrab' : 'grab', label: grabbable ? 'remove grabbable' : '✋ make grabbable' },
    {
      t: 'list', label: 'components', empty: 'no components',
      rows: Object.entries(bag).map(([type, data]) => ({
        id: type, label: type,
        sub: JSON.stringify(data).slice(0, 40),
        actions: [{ k: 'comp-remove', label: 'strip', danger: true }],
      })),
    },
    { t: 'text', k: 'comp-type', label: 'add comp', value: _draft.type, placeholder: 'type e.g. spin' },
    { t: 'text', k: 'comp-data', label: 'data', value: _draft.data, placeholder: '{} (JSON)' },
    { t: 'btn', k: 'comp-add', label: 'add component' },
  ];
}

const _draft = { type: '', data: '' };

// Steppers from the VR renderer arrive as {axis, delta} relatives; DOM sends
// absolutes. One resolver so both surfaces drive the identical dispatcher.
const resolve = (cur, v, i) =>
  (typeof v === 'object' && v !== null && 'delta' in v)
    ? (i != null && v.axis != null ? cur[v.axis] + v.delta : cur + v.delta) : (i != null ? v[i] : v);

// Every edit goes out as a PAIR: the sentence that undoes it and the sentence
// itself (editundo speaks the inverse — there is no shadow state to roll back,
// because the edit was always a verb in the log). Without this the steppers
// were irreversible: a fat-fingered scale had no way home. The workshop's
// channel box already did this; the inspector didn't, which made the nicer
// panel the more dangerous one.
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
    case 'rename': {
      const prev = structuredClone(comps.get(id)?.label ?? null);
      speak('comp', { id, type: 'label', data: v.trim() ? { text: v.trim().slice(0, 48) } : null },
            { id, type: 'label', data: prev });
      break;
    }
    case 'grab': speak('comp', { id, type: 'grab', data: {} }, { id, type: 'grab', data: null }); break;
    case 'ungrab': speak('comp', { id, type: 'grab', data: null }, { id, type: 'grab', data: structuredClone(comps.get(id)?.grab ?? {}) }); break;
    case 'comp-remove': {
      const prev = structuredClone(comps.get(id)?.[v] ?? null);
      speak('comp', { id, type: v, data: null }, { id, type: v, data: prev });
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
        catch (e) { report('comp data', new Error('not valid JSON')); return; }
      }
      speak('comp', { id, type, data }, { id, type, data: null });
      _draft.type = ''; _draft.data = '';
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
  bus.on('ws:open', (on) => { on ? ui.frame.show() : ui.frame.hide(); });
  paint();
}

export const inspectorFields = () => buildFields(currentId);
export const inspectorDispatch = (k, v) => { dispatch(currentId, k, v); };
