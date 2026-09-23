// editschema — what can be edited on a thing, and how, as a PURE FUNCTION of
// its folded record. Dependency-free, shared verbatim by three surfaces:
//
//   desktop inspector   client/lib/editpanels.js renders the fields (panels.js)
//   VR quad             the same fields painted to a canvas (xrpanels.js)
//   models              mcpl `inspect` prints them, `edit` commits them
//
// This is the parity law made structural: anything a human can click, a
// model can say — because both read ONE declaration and both commit through
// editVerbs(). The fold (shared/fold.js) is the source of every value here;
// a client with a realized object may layer live extras on top (is the light
// actually casting) but never a different truth.
//
// inspectSchema(ent, id)          → { groups: [{ group, verb, fields }] }
//   fields are panels.js specs: { t, k, label, value, … } with k a plain name
//   inside the group. Address a field from outside as "<group>.<k>"
//   (pos.x · light.intensity · motion.amp · sockets.seat.yaw · comp.recipe).
// editVerbs(ent, id, edits)       → { verbs: [{verb, args}], errors: [] }
//   edits: { "<group>.<k>": value } — a number, a boolean, a string, or a
//   relative expression ("+=2", "*=-1", "-=10%") against the current value.
//   Edits that share a verb coalesce: three transform channels are ONE place
//   carrying the full pose; two socket fields are ONE merged comp.

const R2D = 180 / Math.PI;
export const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] };
export const MOTION_TYPES = ['pendulum', 'spin', 'orbit', 'bob', 'path'];
export const PARTICLE_PRESETS = ['fire', 'sparks', 'embers', 'smoke', 'dust', 'snow', 'magic', 'stars', 'muzzle'];
const round = (v, dp = 3) => +(+v).toFixed(dp);

/** Typed entry → number, with Maya's relative operators. null = not a number. */
export function parseEntry(text, current) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const t = String(text).trim();
  const m = /^([+\-*/])=\s*(-?\d*\.?\d+)\s*(%?)$/.exec(t);
  if (m) {
    let n = +m[2];
    if (m[3]) n = current * n / 100;
    switch (m[1]) {
      case '+': return current + n;
      case '-': return current - n;
      case '*': return current * n;
      case '/': return n ? current / n : null;
    }
  }
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

function axisName(m, def) {
  const a = m.axis;
  if (typeof a === 'string' && AXES[a.toLowerCase()]) return a.toLowerCase();
  if (Array.isArray(a) && a.length === 3) {
    for (const [k, v] of Object.entries(AXES)) if (v.every((c, i) => c === a[i])) return k;
    return 'custom';
  }
  return def;
}
const isLight = (ent) => ent?.kind === 'light';
const motionKeys = (ent) => Object.keys(ent?.comp ?? {}).filter((k) => (k === 'motion' || k.startsWith('motion:')) && ent.comp[k] && typeof ent.comp[k] === 'object');

// ---------------------------------------------------------------- schema

/** @param ent   the folded entity record (shared/fold.js), or null
 *  @param id    its id
 *  @param live  optional viewer extras: { casting?: boolean, mayAuthor?: boolean }
 *               mayAuthor — may THIS viewer author the thing (its placer, the
 *               owner, an operator)? undefined = unknown: nothing is disabled
 *               on its account and the server decides, as it always does. */
export function inspectSchema(ent, id, live = {}) {
  if (!ent) return { id, groups: [] };
  const c = ent.comp ?? {};
  const mounted = !!ent.parent;
  const locked = !!c.lock;
  // guard (AGENTS.md "Guarding"): only its placer, the world's owner or an
  // operator may author it. The name comes from the STAMP, never the latest
  // actor — an owner's re-light moves `actor` and leaves the placer alone.
  const guarded = !!c.guard;
  const placer = ent.placer?.id ?? ent.actor ?? null;
  const held = guarded && live.mayAuthor === false;
  const groups = [];

  // transform — the entity's LOCAL frame, exactly what `place` takes. A
  // mounted thing's pose is its attach offset: place would store a local
  // pose as the fold's absolute and peers would see nothing. Read-only.
  const tf = { disabled: locked || mounted, hint: locked ? 'locked — unlock to move it' : mounted ? `mounted on ${ent.parent.to} — the attach offset owns this pose; detach to move it` : undefined };
  const pos = ent.pos ?? [0, 0, 0];
  const transform = [
    { t: 'num', k: 'x', label: 'pos x', value: round(pos[0]), step: 0.1, dp: 2, unit: 'm', ...tf },
    { t: 'num', k: 'y', label: 'pos y', value: round(pos[1]), step: 0.1, dp: 2, unit: 'm', ...tf },
    { t: 'num', k: 'z', label: 'pos z', value: round(pos[2]), step: 0.1, dp: 2, unit: 'm', ...tf },
  ];
  if (!isLight(ent)) {
    transform.push({ t: 'num', k: 'yaw', label: 'yaw', value: round(ent.yaw ?? 0, 4), step: 5, deg: true, ...tf });
    transform.push({ t: 'num', k: 'scale', label: 'scale', value: round(ent.scale ?? 1), step: 0.05, dp: 2, min: 0.01, softMax: 12, ...tf });
  }
  const driven = c.motion?.type && !c.motion.part ? 'motion' : null;   // a whole-entity motion composes onto this REST pose
  if (driven) for (const f of transform) f.driven = driven;
  groups.push({ group: 'pos', label: 'Transform', verb: 'place', fields: transform });

  const flags = [];
  if (held) flags.push({ t: 'info', label: '', value: `🛡 guarded by ${placer ?? 'its placer'} — only they, the world's owner or an operator may change, move or remove it (using it and sitting on it stay open)` });
  groups.push({ group: 'flags', label: 'Flags', verb: 'comp', fields: [...flags,
    { t: 'check', k: 'lock', label: 'locked', value: locked, hint: 'nail it down: nobody\'s drags, verbs or scripts can move, replace or remove it (server-enforced); sitting on it and content edits stay open' },
    { t: 'check', k: 'guard', label: 'guarded', value: guarded, disabled: live.mayAuthor === false,
      hint: live.mayAuthor === false ? `only ${placer ?? 'its placer'} or the world's owner can set or clear the guard on this`
        : 'make it yours to author: while guarded, only you, the world\'s owner or an operator can change its components, move it, remove it or bind scripts to it (server-enforced) — using it and sitting on it stay open' },
    { t: 'check', k: 'hidden', label: 'hidden', value: c.hidden === true, hint: 'not drawn, still there — a comp every client honours' },
    { t: 'text', k: 'label', label: 'label', value: typeof c.label === 'string' ? c.label : '', placeholder: 'a name people see', hint: 'a display name (comp label) — the id never changes' },
  ] });

  // look — the first user of the `ref` field: name ANOTHER entity for this one
  // to face. The value is a target id (or null). The picker reuses attach's
  // arming: arm, then click a row or the thing in the world. Only shown once a
  // `look` comp exists (add it via + component) so we add no UI to things that
  // don't use it — the field TYPE is the deliverable; this is its demonstrator.
  if (c.look && typeof c.look === 'object') {
    groups.push({ group: 'look', label: 'look at', verb: 'comp', types: ['look'], fields: [
      { t: 'ref', k: 'target', label: 'target', value: typeof c.look.target === 'string' ? c.look.target : null,
        hint: 'the entity this one faces — pick a row, or the thing itself in the world' },
    ] });
  }

  if (isLight(ent)) {
    const fields = [
      { t: 'color', k: 'color', label: 'color', value: ent.color ?? 0xffd9a0 },
      { t: 'num', k: 'intensity', label: 'brightness', value: ent.intensity ?? 16, step: 1, dp: 0, min: 0, softMax: Math.max(64, ent.intensity ?? 16) },
      { t: 'num', k: 'range', label: 'range', value: ent.range ?? 10, step: 1, dp: 0, min: 1, softMax: Math.max(40, ent.range ?? 10), unit: 'm' },
      { t: 'check', k: 'keep', label: 'keep lit', value: ent.keep === true, hint: 'first claim on a light slot, never governor-shed' },
      { t: 'check', k: 'noon', label: 'burns at noon', value: ent.day === false, hint: 'opts out of the day cycle' },
    ];
    if (live.casting === false) fields.push({ t: 'info', label: '', value: 'glow-only right now (slot pool spent) — it may still cast for others' });
    groups.push({ group: 'light', label: 'light', verb: 'light', fields });
  }

  const mk = motionKeys(ent);
  if (mk.length) {
    const fields = [];
    for (const key of mk) {
      const m = c[key];
      const P = key === 'motion' ? '' : `${key.slice(7)} · `;
      const k = (p) => (key === 'motion' ? p : `${key.slice(7)}|${p}`);
      const types = MOTION_TYPES.includes(m.type) ? MOTION_TYPES : [...MOTION_TYPES, m.type ?? '?'];
      fields.push({ t: 'enum', k: k('type'), label: `${P}type`, value: m.type, options: types.map((v) => ({ v, label: v })) });
      if (['pendulum', 'spin', 'bob'].includes(m.type)) {
        const ax = axisName(m, m.type === 'pendulum' ? 'x' : 'y');
        const opts = Object.keys(AXES).map((v) => ({ v, label: v }));
        fields.push({ t: 'enum', k: k('axis'), label: `${P}axis`, value: ax, options: ax === 'custom' ? [...opts, { v: 'custom', label: 'custom' }] : opts });
      }
      switch (m.type) {
        case 'pendulum':
          fields.push({ t: 'num', k: k('amp'), label: `${P}amp`, value: m.amp ?? m.amplitude ?? 0, step: 5, deg: true, min: 0, softMax: Math.PI });
          fields.push({ t: 'num', k: k('period'), label: `${P}period`, value: m.period ?? 3.5, step: 0.1, dp: 2, min: 0.05, unit: 's' });
          fields.push({ t: 'num', k: k('phase'), label: `${P}phase`, value: m.phase ?? 0, step: 5, deg: true });
          fields.push({ t: 'num', k: k('damp'), label: `${P}damp`, value: m.damp ?? 0, step: 0.01, dp: 3, min: 0, softMax: 2, hint: '0 swings forever; friction is opt-in' });
          break;
        case 'spin':
          fields.push({ t: 'num', k: k('degPerSec'), label: `${P}rate`, value: m.degPerSec != null ? m.degPerSec : (m.rpm ?? 6) * 6, step: 5, dp: 1, unit: '°/s' });
          fields.push({ t: 'num', k: k('phase'), label: `${P}phase`, value: m.phase ?? 0, step: 5, deg: true });
          break;
        case 'orbit':
          fields.push({ t: 'num', k: k('radius'), label: `${P}radius`, value: m.radius ?? 1, step: 0.1, dp: 2, min: 0, unit: 'm' });
          fields.push({ t: 'num', k: k('degPerSec'), label: `${P}rate`, value: m.degPerSec ?? 12, step: 5, dp: 1, unit: '°/s' });
          fields.push({ t: 'check', k: k('face'), label: `${P}face along`, value: m.face !== false });
          break;
        case 'bob':
          fields.push({ t: 'num', k: k('amp'), label: `${P}amp`, value: m.amp ?? m.amplitude ?? 0.3, step: 0.05, dp: 2, min: 0, unit: 'm' });
          fields.push({ t: 'num', k: k('period'), label: `${P}period`, value: m.period ?? 4, step: 0.1, dp: 2, min: 0.05, unit: 's' });
          fields.push({ t: 'num', k: k('phase'), label: `${P}phase`, value: m.phase ?? 0, step: 5, deg: true });
          break;
        case 'path':
          fields.push({ t: 'info', label: `${P}points`, value: `${Array.isArray(m.points) ? m.points.length : 0} points — edit as JSON (comp.${key})` });
          if (m.duration != null && m.speed == null) fields.push({ t: 'num', k: k('duration'), label: `${P}duration`, value: m.duration, step: 0.5, dp: 1, min: 0.1, unit: 's' });
          else fields.push({ t: 'num', k: k('speed'), label: `${P}speed`, value: m.speed ?? 1, step: 0.1, dp: 2, min: 0, unit: 'm/s' });
          fields.push({ t: 'enum', k: k('loop'), label: `${P}loop`, value: m.loop ?? 'loop', options: ['loop', 'pingpong', 'once'].map((v) => ({ v, label: v })) });
          fields.push({ t: 'check', k: k('face'), label: `${P}face along`, value: m.face !== false });
          break;
      }
      fields.push({ t: 'btn', k: k('rest'), label: P ? `${P.trim()} come to rest` : 'come to rest', danger: true });
    }
    groups.push({ group: 'motion', label: 'motion', verb: 'motion', types: mk, fields });
  }

  if (c.sockets && typeof c.sockets === 'object') {
    const slots = Object.keys(c.sockets);
    const fields = [{ t: 'list', k: 'slots', empty: 'no anchors yet', rows: slots.map((slot) => {
      const s = c.sockets[slot] ?? {}; const p = s.pos ?? [0, 0.5, 0];
      return { id: slot, label: slot, sub: `(${p.map((v) => (+v).toFixed(2)).join(', ')}) · ${Math.round((s.yaw ?? 0) * R2D)}°${s.part ? ` · rides ${s.part}` : ''}`, actions: [{ k: 'del', label: '✕', danger: true }] };
    }) }];
    for (const slot of slots) {
      const s = c.sockets[slot] ?? {}; const p = s.pos ?? [0, 0.5, 0];
      ['x', 'y', 'z'].forEach((ax, i) => fields.push({ t: 'num', k: `${slot}|pos|${i}`, label: `${slot} ${ax}`, value: p[i], step: 0.05, dp: 2, unit: 'm' }));
      fields.push({ t: 'num', k: `${slot}|yaw`, label: `${slot} yaw`, value: s.yaw ?? 0, step: 5, deg: true });
    }
    fields.push({ t: 'btn', k: 'add', label: '+ seat here', hint: 'click the spot on the thing where a sitter goes', client: true });
    groups.push({ group: 'sockets', label: 'sockets', verb: 'comp', types: ['sockets'], fields });
  }

  if (c.particles && typeof c.particles === 'object') {
    const p = c.particles; const o = p.origin ?? [0, 0, 0];
    const presets = PARTICLE_PRESETS.includes(p.preset) ? PARTICLE_PRESETS : [...PARTICLE_PRESETS, p.preset ?? '?'];
    groups.push({ group: 'particles', label: 'particles', verb: 'comp', types: ['particles'], fields: [
      { t: 'enum', k: 'preset', label: 'preset', value: p.preset, options: presets.map((v) => ({ v, label: v })) },
      { t: 'num', k: 'count', label: 'count', value: p.count ?? 150, step: 10, dp: 0, min: 1, max: 600 },
      { t: 'num', k: 'origin|0', label: 'origin x', value: o[0], step: 0.05, dp: 2, min: -8, max: 8, unit: 'm' },
      { t: 'num', k: 'origin|1', label: 'origin y', value: o[1], step: 0.05, dp: 2, min: -8, max: 8, unit: 'm' },
      { t: 'num', k: 'origin|2', label: 'origin z', value: o[2], step: 0.05, dp: 2, min: -8, max: 8, unit: 'm' },
      { t: 'num', k: 'size', label: 'size', value: p.size ?? 1, step: 0.1, dp: 2, min: 0.05, softMax: 4 },
      { t: 'num', k: 'opacity', label: 'opacity', value: p.opacity ?? 1, step: 0.05, dp: 2, min: 0, max: 1 },
      { t: 'num', k: 'speed', label: 'speed', value: p.speed ?? 1, step: 0.1, dp: 2, min: 0, softMax: 4 },
      { t: 'num', k: 'lifetime', label: 'lifetime', value: p.lifetime ?? 1, step: 0.1, dp: 2, min: 0.05, softMax: 10, unit: 's' },
      { t: 'enum', k: 'quality', label: 'quality', value: p.quality ?? 'auto', options: ['auto', 'high', 'med', 'low'].map((v) => ({ v, label: v })) },
      { t: 'btn', k: 'out', label: 'put it out', danger: true },
    ] });
  }

  // every type no group speaks for: raw JSON, the blind fold's UI twin —
  // a type invented this morning is editable today
  const claimed = new Set(['lock', 'guard', 'hidden', 'label', 'sockets', 'particles', ...mk]);
  const rest = Object.keys(c).filter((t) => !claimed.has(t));
  const fields = rest.map((type) => ({ t: 'text', k: type, label: type, value: JSON.stringify(c[type]), hint: 'raw JSON — a saved edit replaces this type\'s data wholesale; empty removes it' }));
  fields.push({ t: 'text', k: '+', label: '+ component', value: '', placeholder: 'type (recipe, notice…) ⏎', hint: 'attach a component — any type folds, evaluators give known ones behavior' });
  groups.push({ group: 'comp', label: `Components (${rest.length})`, verb: 'comp', fields });

  // guarded by someone else: every authoring field reads as read-only, with the
  // reason. The server refuses these regardless — this says so before the trip.
  if (held) for (const g of groups) for (const f of g.fields) {
    if (f.t === 'info' || f.disabled) continue;
    f.disabled = true; f.hint = `guarded by ${placer ?? 'its placer'}`;
  }
  return { id, groups, ...(guarded ? { guard: { placer, held } } : {}) };
}

/** The channel box: every num in the schema, flat, with dotted addresses. */
export function channels(schema) {
  const out = [];
  for (const g of schema.groups) for (const f of g.fields) if (f.t === 'num') out.push({ ...f, key: `${g.group}.${f.k}`, group: g.group });
  return out;
}

// ---------------------------------------------------------------- edits → verbs

/** Look a field up by dotted address. */
export function fieldAt(schema, key) {
  const dot = key.indexOf('.');
  if (dot < 0) return null;
  const g = schema.groups.find((x) => x.group === key.slice(0, dot));
  return g ? (g.fields.find((f) => f.k === key.slice(dot + 1)) ?? null) : null;
}

/** Turn edits into the fewest verbs that commit them. Numbers may be
 *  relative expressions; a field's hard min/max clamp; disabled fields
 *  refuse. Pure: never sends, never mutates `ent`. */
export function editVerbs(ent, id, edits) {
  const schema = inspectSchema(ent, id);
  const errors = [];
  const verbs = [];
  const c = ent?.comp ?? {};
  let place = null;                 // coalesced full pose
  let light = null;                 // coalesced partial light
  const comps = new Map();          // type → next data (null = remove)
  const motions = new Map();        // key → next params (null = rest)
  const flagsComp = (type, data) => comps.set(type, data);

  const num = (f, v) => {
    const cur = +f.value;
    let n = parseEntry(f.deg && typeof v === 'string' ? v : v, f.deg ? cur * R2D : cur);
    if (n == null) { errors.push(`${f.label ?? f.k}: not a number (${JSON.stringify(v)})`); return null; }
    if (f.deg) n = n / R2D;
    n = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
    return n;
  };
  const bool = (v) => (typeof v === 'string' ? !/^(false|0|no|off)$/i.test(v) : !!v);

  for (const [key, raw] of Object.entries(edits ?? {})) {
    const f = fieldAt(schema, key);
    const dot = key.indexOf('.'); const group = key.slice(0, dot); const k = key.slice(dot + 1);
    // actions and creations that have no field row: comp.<any>, sockets.del,
    // a socket slot that does not exist yet (sockets.<new>|pos|1 declares it)
    const known = f || (group === 'comp' && k) || (group === 'sockets' && (k === 'del' || k.includes('|')));
    if (!known) { errors.push(`${key}: no such field on ${id}`); continue; }
    if (f?.disabled) { errors.push(`${key}: ${f.hint ?? 'read-only'}`); continue; }
    if (f?.client) { errors.push(`${key}: a viewport gesture, not a value — set the fields it would have set`); continue; }
    switch (group) {
      case 'pos': {
        place ??= { id, pos: [...(ent.pos ?? [0, 0, 0])], ...(isLight(ent) ? {} : { yaw: ent.yaw ?? 0, scale: ent.scale ?? 1 }) };
        const n = num(f, raw); if (n == null) break;
        if (k === 'yaw') place.yaw = round(n, 4);
        else if (k === 'scale') place.scale = round(n);
        else place.pos['xyz'.indexOf(k)] = round(n);
        break;
      }
      case 'flags': {
        if (k === 'lock') flagsComp('lock', bool(raw) ? true : null);
        else if (k === 'guard') flagsComp('guard', bool(raw) ? true : null);
        else if (k === 'hidden') flagsComp('hidden', bool(raw) ? true : null);
        else if (k === 'label') { const s = String(raw ?? '').trim(); flagsComp('label', s ? s.slice(0, 80) : null); }
        break;
      }
      case 'light': {
        light ??= { id };
        if (f.t === 'num') { const n = num(f, raw); if (n == null) break; light[k] = n; }
        else if (k === 'color') light.color = typeof raw === 'string' ? parseInt(raw.replace(/^#|^0x/, ''), 16) : raw;
        else if (k === 'keep') light.keep = bool(raw);
        else if (k === 'noon') light.day = !bool(raw);
        break;
      }
      case 'motion': {
        const bar = k.indexOf('|');
        const mkey = bar < 0 ? 'motion' : `motion:${k.slice(0, bar)}`;
        const param = bar < 0 ? k : k.slice(bar + 1);
        const prev = c[mkey]; if (!prev) { errors.push(`${key}: no ${mkey} on ${id}`); break; }
        if (param === 'rest') { motions.set(mkey, null); break; }
        const next = motions.get(mkey) ?? { ...prev };
        if (param === 'axis') { if (raw === 'custom') break; if (!AXES[String(raw).toLowerCase()]) { errors.push(`${key}: axis must be one of ${Object.keys(AXES).join(' ')}`); break; } next.axis = String(raw).toLowerCase(); }
        else if (param === 'type') {
          if (!MOTION_TYPES.includes(raw)) { errors.push(`${key}: type must be one of ${MOTION_TYPES.join(' ')}`); break; }
          // a type change keeps only what carries across (the evaluator would
          // ignore a spin's amp, and the server lints every leftover); t0 stays
          // so the change is not also a phase jump
          for (const p of Object.keys(next)) if (!['type', 'axis', 'pivot', 'phase', 't0', 'part'].includes(p)) delete next[p];
          next.type = raw;
        }
        else if (param === 'loop') next.loop = raw;
        else if (f.t === 'check') next[param] = bool(raw);
        else { const n = num(f, raw); if (n == null) break; next[param] = round(n, 4); if (param === 'degPerSec') delete next.rpm; if (param === 'amp') delete next.amplitude; }
        motions.set(mkey, next);
        break;
      }
      case 'sockets': {
        const next = comps.get('sockets') ?? JSON.parse(JSON.stringify(c.sockets ?? {}));
        if (k === 'del' && !next[raw]) { errors.push(`sockets.del: no slot ${JSON.stringify(raw)} on ${id}`); break; }
        if (k === 'del') { delete next[raw]; comps.set('sockets', Object.keys(next).length ? next : null); break; }
        const [slot, what, idx] = k.split('|');
        const cur = next[slot] ?? (next[slot] = { pos: [0, 0.5, 0], yaw: 0 });
        const n = num(f ?? { value: what === 'yaw' ? cur.yaw ?? 0 : (cur.pos ?? [0, 0.5, 0])[+idx] ?? 0, deg: what === 'yaw', k }, raw); if (n == null) break;
        if (what === 'pos') { cur.pos = [...(cur.pos ?? [0, 0.5, 0])]; cur.pos[+idx] = round(n); } else cur.yaw = round(n, 4);
        comps.set('sockets', next);
        break;
      }
      case 'particles': {
        if (k === 'out') { comps.set('particles', null); break; }
        const next = comps.get('particles') ?? { ...c.particles };
        if (k.startsWith('origin|')) { const n = num(f, raw); if (n == null) break; next.origin = [...(next.origin ?? [0, 0, 0])]; next.origin[+k.slice(7)] = round(n); }
        else if (f.t === 'num') { const n = num(f, raw); if (n == null) break; next[k] = round(n); }
        else next[k] = raw;
        comps.set('particles', next);
        break;
      }
      case 'look': {
        // the ref field commits the target id, or null to clear it. The whole
        // `look` comp goes away when its only field is cleared.
        if (k === 'target') {
          const next = comps.get('look') ?? { ...c.look };
          if (raw == null || raw === '') { delete next.target; }
          else { next.target = String(raw); }
          comps.set('look', Object.keys(next).length ? next : null);
        }
        break;
      }
      case 'comp': {
        if (k === '+') { const type = String(raw ?? '').trim(); if (!type) break; if (c[type] != null) { errors.push(`${id} already has ${type}`); break; } comps.set(type, {}); break; }
        if (raw == null || raw === '') { comps.set(k, null); break; }
        let data = raw;
        if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch (e) { errors.push(`comp.${k}: not valid JSON (${e.message})`); break; } }
        comps.set(k, data);
        break;
      }
      default: errors.push(`${key}: no such group`);
    }
  }
  if (place) verbs.push({ verb: 'place', args: place });
  if (light) verbs.push({ verb: 'light', args: light });
  for (const [mkey, next] of motions) {
    if (mkey === 'motion') verbs.push({ verb: 'motion', args: next ? { id, ...next } : { id, type: null } });
    else verbs.push({ verb: 'comp', args: { id, type: mkey, data: next } });
  }
  for (const [type, data] of comps) verbs.push({ verb: 'comp', args: { id, type, data } });
  return { verbs, errors };
}

/** A one-screen text rendering of the schema — what a model reads. */
export function describeSchema(schema, { verbsHint = true } = {}) {
  const L = [];
  for (const g of schema.groups) {
    if (!g.fields.length) continue;
    L.push(`${g.label ?? g.group} (${g.group}.* → ${g.verb})`);
    for (const f of g.fields) {
      if (f.t === 'btn' || f.t === 'list') continue;
      if (f.t === 'info') { if (f.value) L.push(`  ${f.value}`); continue; }
      const val = f.t === 'num' ? (f.deg ? `${Math.round(f.value * R2D)}°` : `${+(+f.value).toFixed(f.dp ?? 2)}${f.unit ? ' ' + f.unit : ''}`)
        : f.t === 'color' ? '0x' + (f.value ?? 0).toString(16).padStart(6, '0')
        : f.t === 'enum' ? `${f.value}  [${f.options.map((o) => o.v).join('|')}]`
        : f.t === 'check' ? (f.value ? 'yes' : 'no')
        : f.t === 'text' ? (f.value === '' ? '—' : String(f.value).slice(0, 120)) : String(f.value);
      const lim = f.t === 'num' && (f.min != null || f.max != null || f.softMax != null) ? `  (${f.min ?? ''}…${f.max ?? f.softMax ?? ''}${f.max == null && f.softMax != null ? ' soft' : ''})` : '';
      const ro = f.disabled ? '  [read-only: ' + (f.hint ?? '') + ']' : f.driven ? `  [rest pose — driven by ${f.driven}]` : '';
      L.push(`  ${g.group}.${f.k} = ${val}${lim}${ro}`);
    }
    for (const f of g.fields) if (f.t === 'btn' && !f.client) L.push(`  ${g.group}.${f.k}: action — "${f.label}" (edit with any value)`);
  }
  if (verbsHint) L.push(`edit {id, set: {"pos.x": "+=1", "light.intensity": 24, "flags.lock": true, "comp.recipe": "{...}"}} — relative math (+= -= *= /= and %) works on every number.`);
  return L.join('\n');
}
