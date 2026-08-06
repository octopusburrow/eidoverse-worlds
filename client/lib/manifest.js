// manifest — their 🌳 scene hierarchy, EXACTLY, as a panel that can ride a quad.
//
// R (18:47): "copy their hierarchy panel in their edit mode exactly into our
// manifest… I just want to make sure we don't leave some of their features
// behind." So this is a faithful port of scenegraph.js's tree, feature by
// feature — the SHELL is the only divergence (schema frame → desktop panel or
// VR laser quad; theirs is a makeSection wedged into the world panel).
//
// Ported verbatim in behavior:
//   · every entity (bodies included — theirs doesn't filter to cargo)
//   · row = id bold + short lib name, indented under its mount parent
//   · component badges (motion(type) / sockets(keys) / reactions(keys) / type)
//   · 📜 script badges from the behavior roster
//   · seated bodies as 🧍 rider rows
//   · click row = select (inspector shows it) · click while arming = attach
// Selection actions (find / attach / detach / remove) live in the INSPECTOR
// panel — that's where their inline inspector became a panel of its own.
//
// Kept divergences (additive, R-approved earlier): filter, export/import.

import { bus, report } from './core.js';
import { entities, entityMeta, comps, avatarMounts } from './world.js';
import { sendVerb, requestDebug } from './net.js';
import { makeSchemaFrame } from './panels.js';
import { sceneAttach } from './scenegraph.js';
import { wsSelect } from './workshop.js';
import { flashHint } from './ui.js';

let ui = null, filter = '', selectedId = null;
let arming = null;          // child id waiting for a parent click (their flow)
let behaviorRows = [];      // 📜 badges, same source as theirs

/** Their short-name derivation, verbatim. */
const shortName = (id) => {
  const meta = entityMeta.get(id);
  return (meta?.lib ?? meta?.kind ?? '?').split('/').pop().replace('.glb', '')
    .split('_').slice(0, 3).join(' ');
};

/** Their badge derivation, verbatim. */
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

/** Their tree shape, verbatim: mounts are parenthood, seats are riders. */
function tree() {
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
  return { roots: roots.sort(), kids, riders };
}

async function refreshRoster() {
  try {
    const r = await requestDebug({ behaviors: true });
    behaviorRows = (r.events ?? []).filter((e) => e.kind === 'behavior');
  } catch { /* roster is decoration; the tree must paint without it */ }
}

function rows() {
  const { roots, kids, riders } = tree();
  const q = filter.trim().toLowerCase();
  const out = [];
  const walk = (id, depth) => {
    const short = shortName(id);
    const hit = !q || short.toLowerCase().includes(q) || id.toLowerCase().includes(q);
    if (hit) {
      const badges = badgesFor(id);
      const scripts = behaviorRows.filter((b) => b.attach === id).map((b) => `📜${b.id}`);
      out.push({
        id, depth,
        label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${id} · ${short}`,
        sub: [...badges, ...scripts].join(' · '),
        active: id === selectedId,
        actions: [],
      });
      for (const r of riders.get(id) ?? []) {
        out.push({ id: `rider:${r}`, depth: depth + 1, rider: true,
          label: `${'  '.repeat(depth + 1)}└ 🧍 ${r}`, sub: '', actions: [] });
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
      placeholder: `${all.length} in the world` },
    { t: 'list', label: arming ? `click ${arming}'s new parent…` : 'scene',
      empty: filter ? 'nothing matches' : 'nothing placed yet', rows: all },
    { t: 'btn', k: 'export', label: 'export json' },
    { t: 'btn', k: 'import', label: 'import json' },
  ];
}

/** The inspector's attach button arms; the next manifest row click lands it. */
export function armAttach(childId) {
  arming = arming === childId ? null : childId;
  flashHint(arming ? 'now click the row of its new parent' : 'attach cancelled', 4000);
  paint();
}
export const armedChild = () => arming;

export function dispatch(k, v) {
  if (typeof v === 'string' && v.startsWith('rider:')) return;   // riders aren't rows you can act on
  switch (k) {
    case 'filter': filter = v; break;
    case 'row': {
      if (arming && arming !== v) {           // their arming flow, verbatim
        sceneAttach(arming, v);
        arming = null;
        break;
      }
      arming = null;
      selectedId = v;
      wsSelect(v);
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
  bus.on('mount', paint);            // theirs repaints on mount too
  bus.on('ws:select', (id) => { selectedId = id; paint(); });
  bus.on('ws:open', async (on) => {
    if (on) { ui.frame.show(); await refreshRoster(); paint(); }
    else ui.frame.hide();
  });
  paint();
}

export const manifestFields = () => buildFields();
export const manifestDispatch = dispatch;
