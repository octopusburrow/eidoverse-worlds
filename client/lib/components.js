// components — the registry. Slice 2 of notes/design-scene-edit-surface.md.
//
// One registry drives everything that knows about component types: the Add
// Component menu (both the 🌳 section and the edit surface derive their menus
// from HERE, at open time — never a hardcoded list), inspector editors (a
// registered type may ship its own rows; unregistered types fall back to the
// generic renderer, which must always work), and defaults (what an empty
// instance of the type looks like, so "add" produces something editable
// rather than {}).
//
// A registration is a DESCRIPTION, not a privilege: any module — including a
// third-party one loaded later — calls registerComponent() and appears in
// every menu and inspector with no panel code edited. Design doc §2.3;
// enum-basin discipline: menus are derived from the registry when opened.

const registry = new Map();

/** Register a component type.
 *  spec: {
 *    label?:    string   — menu display (defaults to type)
 *    hint?:     string   — one-liner shown in the Add menu
 *    defaults?: object   — data for a freshly added instance
 *    editor?:   (id, data, ctx) => string   — custom inspector HTML for this
 *               type's section body; return '' to fall back to generic.
 *               ctx = { esc, num, GRID } (the house field helpers).
 *    wire?:     (root, id, commit) => void  — attach listeners to the custom
 *               editor's DOM; commit(data) speaks the comp verb.
 *  }
 *  Later registrations of the same type win (latest module knows best). */
export function registerComponent(type, spec = {}) {
  registry.set(type, { label: type, ...spec });
}

/** All registered types, for menus — sorted, derived at call time. */
export function componentTypes() {
  return [...registry.keys()].sort();
}

export function componentSpec(type) { return registry.get(type) ?? null; }

export function defaultsFor(type) {
  return structuredClone(registry.get(type)?.defaults ?? {});
}

// ---- built-in registrations (the upstream vocabulary, described) ----------
// Registering a type here does NOT change how it folds — meaning still lives
// in the evaluator that consumes it. This is descriptive metadata so the
// editing surface can offer what the world already understands.

registerComponent('ambient', {
  hint: 'looping place-sound: this thing is the source',
  defaults: { src: 'assets/porch_ambient.ogg', gain: 0.7, radius: 18, loop: true },
});
registerComponent('sockets', {
  hint: 'named attachment points (seats, mounts)',
  defaults: { seat: { pos: [0, 1, 0], yaw: 0, pose: 'sit' } },
});
registerComponent('reactions', {
  hint: 'use-verb responses (push, open…)',
  defaults: {},
});
registerComponent('motion:pendulum', {
  hint: 'swing about a pivot, damped or perpetual',
  defaults: { type: 'pendulum', axis: [0, 0, 1], pivot: [0, 2, 0], amplitude: 0.2, period: 3 },
});
registerComponent('motion:spin', {
  hint: 'rotate forever about an axis',
  defaults: { type: 'spin', axis: [0, 1, 0], period: 8 },
});
registerComponent('motion:bob', {
  hint: 'float up and down',
  defaults: { type: 'bob', axis: [0, 1, 0], amplitude: 0.25, period: 4 },
});
