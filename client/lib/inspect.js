// inspect — the client's half of shared/editschema.js.
//
// WHAT can be edited on a thing, and with which verb, is declared ONCE, as a
// pure function of the folded record (shared/editschema.js) — the desktop
// inspector, the VR quad and a model's `inspect`/`edit` tools all read it.
// This module is the part only a client with a live scene can add:
//
//   commitEdit(id, key, value, {live})
//     live   → PREVIEW: the group's handler moves the realized object (a
//              light brightens, a seat gizmo slides) — no log traffic;
//     final  → COMMIT: editVerbs() turns the edit into the fewest verbs; the
//              inverse (from the record as it was when the gesture began)
//              goes on the undo stack; the verbs go out. Light verbs ride
//              lights.js's coalescer so a drag never outruns the rate limit.
//
//   registerHandler(group, fn(id, obj, k, value, opts) → handled?)
//     evaluator modules install previews and viewport GESTURES here ('+ seat
//     here' arms a click-to-place; a row click selects a gizmo). Returning
//     true means "done, don't commit" — a live preview always is; a final
//     edit usually isn't, and falls through to editVerbs.
//
// The html+wire form (registerEditor) survives for the World›Scene section
// until it retires; that panel also gets the schema groups, rendered by the
// factory, through the same commit path.

import { entities } from './world.js';
import { state } from './state.js';
import { sendVerb } from './net.js';
import { renderDOM } from './panels.js';
import { inspectSchema, editVerbs } from '../../shared/editschema.js';

const handlers = new Map();      // group → fn
const htmlEditors = [];
let hooks = { undo: null, commitLight: null, casting: null };

export function registerHandler(group, fn) { handlers.set(group, fn); }
export function registerEditor(fn) { htmlEditors.push(fn); }
/** editpanels installs the undo stack and the light coalescer at init —
 *  importing build.js from here would close an import loop through
 *  scenegraph.js. */
export function setEditHooks(h) { hooks = { ...hooks, ...h }; }

/** The folded record for a placed thing — exactly what the schema reads. */
export const foldRecord = (id) => state.st.entities?.[id] ?? null;
export function schemaFor(id) {
  const rec = foldRecord(id); if (!rec) return { id, groups: [] };
  const obj = entities.get(id);
  return inspectSchema(rec, id, { casting: obj?.userData?.isLight ? hooks.casting?.(obj) : undefined });
}

let gesture = null;   // { id, rec } — the record as it stood when a drag began
export function endGesture() { gesture = null; }

/** Inverse of a verb about to be sent, against the record it was computed from. */
function inverseOf(v, rec, id) {
  switch (v.verb) {
    case 'place': return { verb: 'place', args: { id, pos: [...(rec.pos ?? [0, 0, 0])], yaw: rec.yaw ?? 0, ...(rec.scale != null ? { scale: rec.scale } : {}) } };
    case 'light': {
      const back = { id };
      for (const k of Object.keys(v.args)) if (k !== 'id') back[k] = k === 'day' ? rec.day !== false : k === 'keep' ? rec.keep === true : rec[k];
      return { verb: 'light', args: back };
    }
    case 'motion': return { verb: 'motion', args: rec.comp?.motion ? { id, ...rec.comp.motion } : { id, type: null } };
    case 'comp': return { verb: 'comp', args: { id, type: v.args.type, data: rec.comp?.[v.args.type] ?? null } };
  }
  return null;
}

export function commitEdit(id, key, value, opts = {}) {
  const rec = foldRecord(id);
  const obj = entities.get(id);
  if (!rec) return { ok: false, errors: [`${id} is not in the fold`] };
  const dot = key.indexOf('.');
  const group = key.slice(0, dot), k = key.slice(dot + 1);
  const live = !!opts.live;
  if (live && (!gesture || gesture.id !== id)) gesture = { id, rec: JSON.parse(JSON.stringify(rec)) };
  const h = handlers.get(group);
  if (h) { try { if (h(id, obj, k, value, opts)) { if (!live) gesture = null; return { ok: true, handled: true }; } } catch (e) { console.warn(`[inspect] ${group} handler`, e); } }
  if (live) return { ok: true, live: true };
  const base = gesture?.id === id ? gesture.rec : rec;   // the pose/values before the drag began
  gesture = null;
  const { verbs, errors } = editVerbs(rec, id, { [key]: value });
  for (const v of verbs) {
    const inv = inverseOf(v, base, id);
    if (inv) hooks.undo?.(inv, `${key} of ${id}`);
    if (v.verb === 'light' && hooks.commitLight) { const { id: _i, ...patch } = v.args; hooks.commitLight(id, patch); }
    else sendVerb(v.verb, v.args);
  }
  return { ok: !errors.length, errors, verbs };
}

/** Every editor as html+wire for the legacy section: the registered html
 *  editors, then the schema's component groups rendered by the factory. */
export function editorsFor(ctx) {
  const out = [];
  for (const fn of htmlEditors) { try { const e = fn(ctx); if (e) out.push(e); } catch { /* skip it */ } }
  const schema = schemaFor(ctx.id);
  schema.groups.filter((g) => !['pos', 'flags', 'comp'].includes(g.group)).forEach((g, i) => {
    const host = `data-fe="${i}"`;
    out.push({
      html: `<div style="margin:4px 0"><b>${ctx.esc?.(g.label ?? g.group) ?? g.group}</b><div ${host}></div></div>`,
      wire(root) {
        const div = root.querySelector(`[${host}]`);
        if (div) renderDOM(div, g.fields, (k, v, _f, o) => { if (k === 'fold') return; commitEdit(ctx.id, `${g.group}.${k}`, v, o); });
      },
    });
  });
  return out;
}
