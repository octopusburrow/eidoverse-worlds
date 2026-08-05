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
    { t: 'num', k: 'yaw', label: 'yaw°', value: obj.rotation.y * 180 / Math.PI, step: 15, dp: 0 },
    { t: 'num', k: 'scale', label: 'scale', value: obj.scale.x, step: 0.1, dp: 2, min: 0.01 },
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

export function dispatch(id, k, v) {
  const obj = entities.get(id);
  if (!obj) return;
  switch (k) {
    case 'pos': {
      const p = (typeof v === 'object' && 'delta' in v)
        ? obj.position.toArray().map((c, i) => (i === v.axis ? c + v.delta : c)) : v;
      sendVerb('place', { id, pos: p });
      break;
    }
    case 'yaw': sendVerb('place', { id, yaw: resolve(obj.rotation.y * 180 / Math.PI, v) * Math.PI / 180 }); break;
    case 'scale': sendVerb('place', { id, scale: Math.max(0.01, resolve(obj.scale.x, v)) }); break;
    case 'rename':
      sendVerb('comp', { id, type: 'label', data: v.trim() ? { text: v.trim().slice(0, 48) } : null });
      break;
    case 'grab': sendVerb('comp', { id, type: 'grab', data: {} }); break;
    case 'ungrab': sendVerb('comp', { id, type: 'grab', data: null }); break;
    case 'comp-remove': sendVerb('comp', { id, type: v, data: null }); break;
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
      sendVerb('comp', { id, type, data });
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
    title: 'inspector', x: -10, y: 40, w: 320, h: 420, minW: 260, minH: 200,
  });
  ui.frame.hide();
  bus.on('selection', ({ id }) => { currentId = id; paint(); });
  bus.on('entity', ({ id }) => { if (id === currentId) paint(); });
  bus.on('comp', ({ id }) => { if (id === currentId) paint(); });
  bus.on('edit-mode', (on) => { on ? ui.frame.show() : ui.frame.hide(); });
  paint();
}

export const inspectorFields = () => buildFields(currentId);
export const inspectorDispatch = (k, v) => { dispatch(currentId, k, v); };
