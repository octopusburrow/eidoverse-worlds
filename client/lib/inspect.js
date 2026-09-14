// inspect — the per-type editor registry for the inspector.
//
// The inspector's GENERIC layer (transform channels, raw component JSON) is
// meaning-free by design — it mirrors the blind fold, so a comp type invented
// tomorrow is editable today with zero new UI. But sliders and honest labels
// need MEANING (what's a sane brightness? what exactly does `keep` promise?),
// and meaning lives in the evaluator modules. So evaluators register editors
// here; the inspector composes every editor that claims the selected entity,
// above the generic JSON fallback.
//
// An editor DECLARES FIELDS (panels.js schema) — it never owns DOM. One
// declaration is a desktop row set, a VR quad, and a channel in the channel
// box; the same dispatcher answers all three. Godot's inspector works this
// way (a property announces type+hint, a factory builds the widget; the
// factory is a plugin like any other — editor_node.cpp:8418); this is the
// same shape with JSON hints instead of a hint_string mini-language.
//
//   registerFields(fn)   fn(ctx) => null | { group, fields, dispatch }
//     ctx      = { id, obj, meta, bag, commit(verb, args) }
//     group    = label for the inspector section (and the channel prefix)
//     fields   = panels.js field specs; `num` fields also surface as channels
//     dispatch = (k, value, field, { live }) — live:true while a drag is in
//                progress (PREVIEW locally, no log traffic); otherwise the
//                gesture ended: commit ONE verb.
//
// The html+wire form (registerEditor) survives for the World›Scene section
// until it retires; a fields editor is adapted into it automatically so no
// editor is written twice.

import { renderDOM } from './panels.js';

const fieldEditors = [];
const htmlEditors = [];

/** Called by evaluator modules at import time. */
export function registerFields(fn) { fieldEditors.push(fn); }
export function registerEditor(fn) { htmlEditors.push(fn); }

/** Every fields editor's claim on this selection. */
export function fieldEditorsFor(ctx) {
  const out = [];
  for (const fn of fieldEditors) {
    // one broken editor must never take down the whole panel
    try { const e = fn(ctx); if (e?.fields?.length) out.push(e); } catch { /* skip it */ }
  }
  return out;
}

/** Every editor as html+wire — fields editors included, rendered by the
 *  schema factory into a host div at wire time. */
export function editorsFor(ctx) {
  const out = [];
  for (const fn of htmlEditors) {
    try { const e = fn(ctx); if (e) out.push(e); } catch { /* skip it */ }
  }
  fieldEditorsFor(ctx).forEach((e, i) => {
    const host = `data-fe="${i}"`;
    out.push({
      html: `<div style="margin:4px 0"><b>${ctx.esc?.(e.group ?? '') ?? e.group ?? ''}</b><div ${host}></div></div>`,
      wire(root) {
        const div = root.querySelector(`[${host}]`);
        if (div) renderDOM(div, e.fields, (k, v, f, o) => e.dispatch(k, v, f, o));
      },
    });
  });
  return out;
}
