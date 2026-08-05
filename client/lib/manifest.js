// manifest — what's aboard the world, as a standalone panel.
//
// This is a deliberate FORK of their scenegraph 🌳 section (R's call, 00:13:
// "duplicate their hierarchy and keep developing it under the name Manifest").
// The hierarchy logic is theirs and good — mounted things nest under their
// parent, seated bodies hang off as riders. What's forked is the SHELL: their
// version is a section wedged into the shared world panel via makeSection,
// which cannot cross into VR. This is a schema panel, so the same tree paints
// as a frame on desktop and a laser-clickable quad in the headset from one
// field list.
//
// Divergence from theirs, so far:
//   + import/export — the aboard/ashore boundary; nothing upstream has it
//   + row click drives the same selection the inspector edits
//   - no script rows yet (📜 stays theirs; it's debug UI for the behavior tier)
//
// A ship's manifest, for a world that literally is a log.

import { bus, report } from './core.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb } from './net.js';
import { makeSchemaFrame } from './panels.js';
import { recordPair } from './editundo.js';
import { wsSelect, isWorkshopOpen } from './workshop.js';

let ui = null, filter = '', selectedId = null;

const label = (id) => comps.get(id)?.label?.text
  ?? entityMeta.get(id)?.lib?.split('/').pop()?.replace(/\.(glb|vrm)$/, '')
  ?? id;

/** Mounts are parenthood: their tree shape, ported verbatim in spirit. */
function tree() {
  const kids = new Map();
  const roots = [];
  for (const [id, obj] of entities) {
    if (!entityMeta.get(id)?.lib) continue;          // bodies aren't cargo
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
  return { roots: roots.sort(), kids, riders };
}

/** Flatten to rows, depth carried so any renderer can indent it. */
function rows() {
  const { roots, kids, riders } = tree();
  const q = filter.trim().toLowerCase();
  const out = [];
  const walk = (id, depth) => {
    const name = label(id);
    const hit = !q || name.toLowerCase().includes(q) || id.toLowerCase().includes(q);
    if (hit) {
      const bag = comps.get(id) ?? {};
      const marks = [];
      if (bag.grab) marks.push('grab');
      if (bag.motion) marks.push('moving');
      if (entities.get(id)?.userData?.mountedTo) marks.push('mounted');
      out.push({
        id, depth,
        label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${name}`,
        sub: marks.join(' · ') || `by ${entityMeta.get(id)?.actor ?? '?'}`,
        active: id === selectedId,
        actions: [{ k: 'delete', label: 'del', danger: true }],
      });
      for (const r of riders.get(id) ?? []) {
        out.push({ id: `rider:${r}`, depth: depth + 1, rider: true,
          label: `${'  '.repeat(depth + 1)}└ ${r}`, sub: 'riding', actions: [] });
      }
    }
    for (const k of (kids.get(id) ?? []).sort()) walk(k, depth + 1);
  };
  for (const id of roots) walk(id, 0);
  return out;
}

export function buildFields() {
  const all = rows();
  return [
    { t: 'text', k: 'filter', label: 'find', value: filter,
      placeholder: `${all.length} aboard` },
    { t: 'list', label: 'aboard', empty: filter ? 'nothing matches' : 'nothing placed yet', rows: all },
    { t: 'btn', k: 'export', label: 'export json' },
    { t: 'btn', k: 'import', label: 'import json' },
  ];
}

export function dispatch(k, v) {
  if (typeof v === 'string' && v.startsWith('rider:')) return;   // riders aren't cargo
  switch (k) {
    case 'filter': filter = v; break;
    case 'row': selectedId = v; wsSelect(v); break;
    case 'delete': {
      // Deleting is the one edit nobody expects to be reversible, which is
      // exactly why it should be: the inverse of `remove` is the `spawn` that
      // put it there, plus its transform and every component it wore.
      const o = entities.get(v);
      const meta = entityMeta.get(v);
      if (o && meta?.lib) {
        const worn = Object.entries(comps.get(v) ?? {})
          .map(([type, data]) => ({ verb: 'comp', args: { id: v, type, data: structuredClone(data) } }));
        recordPair(
          { verb: 'spawn', args: { id: v, lib: meta.lib, pos: o.position.toArray(), yaw: o.rotation.y },
            also: [
              { verb: 'place', args: { id: v, rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() } },
              ...worn,
            ] },
          { verb: 'remove', args: { id: v } });
      }
      sendVerb('remove', { id: v });
      break;
    }
    case 'export': {
      const things = [];
      for (const [id, meta] of entityMeta) {
        const o = entities.get(id);
        if (!meta?.lib || !o) continue;
        things.push({
          lib: meta.lib, pos: o.position.toArray(),
          rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray(),
          mountedTo: o.userData?.mountedTo ?? undefined,
          comps: comps.get(id) ?? {},
        });
      }
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
          // Cargo delivery, not a state overwrite: everything replays through
          // the same verbs anyone speaks, under fresh ids.
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
    title: 'manifest', x: 10, y: 52, w: 280, h: 400, minW: 220, minH: 180,
  });
  ui.frame.hide();
  bus.on('entity', paint);
  bus.on('comp', paint);
  // OUR edit mode (R, 00:14: "in our edit mode"), not their `B` — workshop.js
  // is deliberately unentangled from their surfaces, and these panels are ours.
  bus.on('ws:select', (id) => { selectedId = id; paint(); });
  bus.on('ws:open', (on) => { on ? ui.frame.show() : ui.frame.hide(); });
  paint();
}

export const manifestFields = () => buildFields();
export const manifestDispatch = dispatch;
