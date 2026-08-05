// manifest — the left hand (R, 21:56): what's aboard the world. A ship's
// manifest for a world that literally is a log. Row click selects (the
// inspector picks it up), delete removes, and the aboard/ashore boundary —
// import/export — lives here.
//
// Export is a plain JSON snapshot of the placed things (lib, transform,
// comps). Import replays it through the same spawn/place/comp verbs anyone
// uses, under fresh ids — a cargo delivery, not a state overwrite.

import { bus, report } from './core.js';
import { entities, entityMeta, comps } from './world.js';
import { sendVerb } from './net.js';
import { makeSchemaFrame } from './panels.js';
import { select } from './build.js';

let ui = null, filter = '', selectedId = null;

const label = (id) => comps.get(id)?.label?.text
  ?? entityMeta.get(id)?.lib?.split('/').pop()?.replace(/\.(glb|vrm)$/, '')
  ?? id;

const aboard = () => [...entityMeta.entries()]
  .filter(([id, m]) => m?.lib && entities.get(id))
  .map(([id, m]) => ({ id, meta: m }));

export function buildFields() {
  const q = filter.trim().toLowerCase();
  const things = aboard()
    .filter(({ id }) => !q || label(id).toLowerCase().includes(q) || id.toLowerCase().includes(q))
    .sort((a, b) => label(a.id).localeCompare(label(b.id)));
  return [
    { t: 'text', k: 'filter', label: 'find', value: filter, placeholder: `${aboard().length} things aboard` },
    {
      t: 'list', label: 'aboard', empty: q ? 'nothing matches' : 'nothing placed yet',
      rows: things.map(({ id, meta }) => ({
        id, label: label(id), sub: `by ${meta.actor ?? '?'}`,
        active: id === selectedId,
        actions: [{ k: 'delete', label: 'del', danger: true }],
      })),
    },
    { t: 'btn', k: 'export', label: 'export json' },
    { t: 'btn', k: 'import', label: 'import json' },
  ];
}

export function dispatch(k, v) {
  switch (k) {
    case 'filter': filter = v; break;
    case 'row': selectedId = v; select(v); break;
    case 'delete': sendVerb('remove', { id: v }); break;
    case 'export': {
      const things = aboard().map(({ id, meta }) => {
        const o = entities.get(id);
        return {
          lib: meta.lib, pos: o.position.toArray(),
          rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray(),
          comps: comps.get(id) ?? {},
        };
      });
      const blob = new Blob([JSON.stringify({ v: 1, things }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `manifest-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      break;
    }
    case 'import': {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        try {
          const doc = JSON.parse(await inp.files[0].text());
          for (const t of doc.things ?? []) {
            if (!t.lib) continue;
            const id = `${t.lib.split('/').pop().replace(/\.\w+$/, '').slice(0, 20)}-${Math.random().toString(36).slice(2, 7)}`;
            sendVerb('spawn', { id, lib: t.lib, pos: t.pos ?? [0, 0, 0], yaw: t.yaw ?? 0 });
            if (t.rot || t.scale != null) {
              sendVerb('place', { id, ...(t.rot ? { rot: t.rot } : {}),
                ...(t.scale != null ? { scale: t.scale } : {}) });
            }
            for (const [type, data] of Object.entries(t.comps ?? {})) {
              sendVerb('comp', { id, type, data });
            }
          }
        } catch (e) { report('manifest import', e); }
      };
      inp.click();
      break;
    }
  }
}

function paint() { ui?.set(buildFields(), (k, v) => { dispatch(k, v); paint(); }); }

export function initManifest() {
  ui = makeSchemaFrame('manifest', {
    // y: 52 clears the top bar (see inspector.js — 40 hid the edit button)
    title: 'manifest', x: 10, y: 52, w: 270, h: 380, minW: 220, minH: 180,
  });
  ui.frame.hide();
  bus.on('entity', paint);
  bus.on('comp', paint);
  bus.on('selection', ({ id }) => { selectedId = id; paint(); });
  bus.on('edit-mode', (on) => { on ? ui.frame.show() : ui.frame.hide(); });
  paint();
}

export const manifestFields = () => buildFields();
export const manifestDispatch = dispatch;
