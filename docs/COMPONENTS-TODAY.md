# Component-like things, as they are today

A baseline, written before anything is ported onto component records (RFC
#208, step 1). It says what exists, where it lives on the record, who writes
it, who reads it, what an old or unknown client does with it, and where it is
scarred. **Facts only**: no proposals here; the design lives in the RFC.
Every claim cites `file:line` as of the commit that adds this file; if a line
has moved, the code wins and this file has a bug.

Why it lives in `docs/` and not in `spec/PROTOCOL.md` §4 or AGENTS.md:
PROTOCOL.md is the normative, CC0 contract, and listing a scar there would
read as a promise; AGENTS.md is the how-to manual. This is a survey of one
implementation, like `docs/REFACTOR-SURVEY.md`, kept so a reviewer can check
later that a port preserved what was here.

Pinned by test: `tools/unknown-comp-test.ts` (section 1). Run with
`BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/unknown-comp-test.ts`.

## 0. The plumbing every component shares

- **On the record.** A folded entity is
  `{lib? | kind:"light", pos, yaw?, scale?, collide?, color?, intensity?,
  range?, keep?, day?, placer?, born, actor, ts, comp?, parent?}`
  (shared/fold.js:62-80). `comp` is the bag: `type → data`, folded blind.
- **The door.** `comp {id, type, data|null}` (server/verbs.ts:209-232): `id`
  is cut to 64 chars and `type` to 32 (truncated, not refused); `data` over
  8192 bytes of JSON is refused; `type: "captions"` is refused (it has its own
  verb). Nothing else about the type or the data is checked. Builder rank
  (server/rights.ts VERB_NEEDS `comp: { rank: 1 }`), subject to lock and guard
  (server/verbs.ts:595-609). After append, only `motion*` and `particles` are
  linted into the flight recorder (server/verbs.ts:391-400).
- **The fold.** `comp` sets or deletes one key and deletes an emptied bag
  (shared/fold.js:424-437); `captions` is refused there too (fold.js:431).
  The `motion` verb is sugar for `comp.motion` (fold.js:438-454).
- **The browser.** The models realizer mirrors each folded bag into the
  `comps` map (client/lib/world.js:45) as a clone (realize/models.js:548-552),
  re-announces the whole bag on create (models.js:554-558) and one type per
  live `comp`/`motion` entry (models.js:568-582, 914-919) as a bus event
  `comp {id, type, data}`. Every evaluator filters that event by type. A
  throwing listener is caught per listener (client/lib/base.js:25-28); a throw
  in the realizer's own entry handling is caught and `report()`ed
  (models.js:929). The structure realizer is the exception: it reads the fold
  directly through `onWorldChange` (realize/structure.js:406-428).
- **Text tier.** The mcpl agent's `look()` names known types in prose and
  lists every other type as `components: a, b` (mcpl/agent.ts:3109-3153).
- **Inspector.** `shared/editschema.js` declares the editable groups as a pure
  function of the folded record (`inspectSchema`, :75-292) and turns edits
  into verbs (`editVerbs`, :314-476); the browser panel, the VR quad and the
  `inspect`/`edit` tools all read it.
- **Late join.** The browser adopts the snapshot state as-is
  (client/lib/state.js:73-88). The mcpl agent re-expresses it as synthetic
  entries (`stateToEntries`, shared/fold.js:550-634) and folds those
  (mcpl/agent.ts:696, 1218).

## 1. An unknown component — what happens today

Asked by the port plan ("check what the current client does with unknown
comps first"). Every row is a check in `tools/unknown-comp-test.ts` unless
marked.

| tier | what it does | where |
|---|---|---|
| door | accepts; appends the data byte-for-byte; no flight-recorder line; a type name over 32 chars is truncated; > 8 KB is the only refusal | server/verbs.ts:209-232, 391-400 |
| fold | keeps it verbatim; a second `comp` of the type replaces it wholesale; `null` removes it and an emptied bag is deleted; survives `stateToEntries` → fold | shared/fold.js:424-437, 607 |
| browser | mirrors it into `comps`, announces it on the bus on join, replace and remove; no evaluator claims it; `report()` is never called (tested) and no console line is written (by reading: the path and every listener's type filter); the entity realizes normally | realize/models.js:548-582 |
| browser frame loop | `tickMotion` walks past a non-motion key; an unknown motion *type* stands still | client/lib/motion.js:125-136, 165-170 |
| inspector | a raw-JSON field in the Components group; saving sends one `comp` replacing the data; an empty field removes it | shared/editschema.js:274-283, 445-458 |
| text tier | listed by name: `components: <type>` (live-tested by tools/compfold-test.ts:112, tools/comptest.ts:184; not in the unit test) | mcpl/agent.ts:3152-3153 |
| server meaning | none: the server gives meaning only to `lock`, `guard`, `reactions`, `captions` (and lints `motion*`, `particles`); every bag, unknown types included, is handed through verbatim to scripts (`world.entity`) and to `/geom` | server/rights.ts:137-253, server/reactions.ts:33-71, server/verbs.ts:255-261, server/behaviors.ts:260, server/routes.ts:526, 538 |

So: **ignored, never crashed, never logged.** It persists, replays and is
editable as JSON; it is visible to text-tier residents only as its type name.
An old client meeting a type invented after it was loaded takes exactly this
path, since nothing distinguishes "new" from "unknown".

Partly-known components degrade more finely, each by its own rule:
an unknown motion type stands still (motion.js:165-170, 109-110) and
`evalWholeMotion` refuses it for text tier (client/lib/motioneval.js:210-211);
an unknown particle preset folds and reads as an emitter but draws nothing
(shared/particles.js:170-176); unknown keys in `picture`, `sound` and
`particles` bags are named in a console note and ignored
(shared/picture.js:79-80, shared/sound.js:73-74, shared/particles.js:177-178).

## 2. The inventory

Each entry: **lives** (where on the record), **fields** (with the defaults the
code actually applies), **written by**, **read by**, **old/unknown client**,
**scars**.

### Model (`lib`)

- **Lives:** `entities[id].lib` (+ `pos`, `yaw`, `scale`, `collide`, `born`,
  `placer`) — shared/fold.js:192-212.
- **Fields:** `lib` (required: a `spawn` without one folds to nothing,
  fold.js:193); `pos` default `[0,0,0]`, `yaw` default `0` (fold.js:196);
  `scale` stored only if given; `collide` `"exact"|"box"` stored only if
  given (fold.js:200-207).
- **Written by:** `spawn` (create or wholesale replace, PROTOCOL §3.1),
  `place` (transform; a non-finite `pos` is ignored, `yaw`/`scale` are not
  checked, fold.js:214-225). The server stamps `placer` (server/verbs.ts:
  624-627) and, under a sim epoch, `box` (server/verbs.ts:432-438).
- **Read by:** browser `realize/models.js` (`createModel` :197-213 with
  residency/placeholder streaming; realized object :300-334); colliders
  (`fitCollider`, client/lib/colliders.js:297); the sim fold reads `box`
  (shared/sim.js:34-38, 163); text tier names it by the file stem
  (mcpl/agent.ts:3103); inspector Transform group (editschema.js:93-104).
- **Old/unknown client:** n/a (every client knows `lib`). A client loads
  nothing for an entity beyond its residency radius until approached
  (models.js:202-213).
- **Scars:** apart from a light, there is no entity without a model — a
  structure rides a placeholder `lib` (below). `collide` is browser-only: the agent's snapshot
  path drops it on purpose (mcpl/agent.ts:104-116), and the inspector has no
  field for it. `born` is a fold-derived generation (fold.js:26-31), not
  authored.

### Light (`kind: "light"`)

- **Lives:** `entities[id].kind = "light"` with `color`, `intensity`,
  `range`, `keep`, `day`. **There is no `lib` and no `lib: 'light'` on the
  record**; `"(light)"` is a display stand-in the agent and one client module
  invent (mcpl/agent.ts:1183, 3103; client/lib/physobj.js:267).
- **Fields and defaults:** `pos [0,1,0]`, `color 0xffd9a0`, `intensity 16`,
  `range 10` (shared/fold.js:242-245); `keep: true` / `day: false` stored only
  in their non-default state (fold.js:246-247).
- **Written by:** the `light` verb only. Light-on-light is a partial update
  that keeps the comp bag, parent, yaw/scale and first placer; light on a
  model id (or spawn on a light id) replaces wholesale (fold.js:226-266,
  PROTOCOL §3.1). `place` moves it.
- **Read by:** browser `createLight`/`refreshLight` (realize/models.js:434-447,
  476-501) → a gizmo sphere plus a request to the light rig's fixed slot pool
  (client/lib/lights.js:54-70, client/lib/lightrig.js:352-358); inspector
  `light` group (editschema.js:129-138); snapshot synthesis re-emits it as a
  `light` (+ `place` for yaw/scale) (fold.js:572-590).
- **Text tier:** `(light)` and nothing else: no colour, brightness or range
  (mcpl/agent.ts:3103).
- **Scars:** the defaults are written three more times beside the fold:
  `makeLight` (lights.js:54), the rig's `requestLight` (lightrig.js:355) and
  the inspector (editschema.js:131-133). A light can carry any comp, but the
  comps that need a model part (`picture`, part motions, part sockets) have
  none to find. The fold keeps a placed light's `yaw`/`scale`
  (fold.js:257-258) but the browser applies only its position
  (models.js:438, 492-495) and the inspector hides both
  (editschema.js:98-101). Being a light is a KIND of entity, so an entity
  cannot be a model and a light at once.

### Inferred lamps (not on the record)

- **Lives:** nowhere in the log. Each realized model's emissive meshes
  (flat emissive > 0.5, or an emissive map driven above 1) become up to two
  light-rig requests, colour from the emissive when saturated, else
  `0xffd9a0`; intensity `min(40, 6 + 2.6·glow)`; range 12; day-aware
  (client/lib/lightrig.js:409-455), called for every placed model
  (realize/models.js:411).
- **Read by:** the browser's rig only, below authored lights in priority
  (lightrig.js:346). Text tier and the inspector do not know they exist.
- **Scars:** a property of asset bytes, not of the world log: two clients
  agree only because they load the same GLB.

### Motion (`comp.motion`, `comp["motion:<part>"]`)

- **Lives:** `comp.motion` (whole entity, or one named node if its data
  carries `part`) and any number of `comp["motion:<part>"]` keys
  (client/lib/motion.js:20-31).
- **Fields and defaults** (as evaluated): pendulum `axis [1,0,0]`, `period
  3.5`, `amp 0` (`amplitude` accepted), `phase 0`, `damp 0`; spin
  `degPerSec` or `rpm`·6, default 36°/s; orbit `degPerSec 12`; bob `amp 0.3`,
  `period 4`, `axis [0,1,0]`; path `speed` (or from `duration`), `loop
  "loop"`, `face` true (client/lib/motioneval.js:96-102, 176-209). Axes
  accept `"x"|"-y"|…` (motioneval.js:67-75). `maxAmp` (default 1.1 rad) is
  read only by the server's impulse (server/reactions.ts:92).
- **Written by:** the `motion` verb (the fold stamps `t0 = entry.ts` when
  absent; `{type:null}` deletes, fold.js:438-454); a `comp` of type `motion`
  or `motion:<part>` (no `t0` stamp); the server's pendulum reaction (below);
  inspector edits (`motion` verb for the whole entity, `comp` for parts,
  editschema.js:470-473).
- **Read by:** browser `tickMotion` every frame within 90 m
  (motion.js:125-191); text tier through the same evaluator
  (`evalWholeMotion`, motioneval.js:169-219; `in motion (<type>)`,
  mcpl/agent.ts:3113); server lint (server/lint.ts:52); inspector
  (editschema.js:141-186).
- **Old/unknown client:** an unknown type stands still; a client that
  predates part motion does not animate parts (motion.js:10-11, 29-30).
- **Scars:**
  - **Mirrored math** (AGENTS.md house rule 2): `pendulumImpulse`
    (server/reactions.ts:79-105) and `pendulumTheta`
    (client/lib/motioneval.js:99-102) implement one pendulum twice.
  - **Defaults that disagree.** Pendulum pivot: `[0,2,0]` for a whole entity
    (motioneval.js:180, and the impulse, reactions.ts:98) but `[0,0,0]` for a
    part (motion.js:80). Orbit radius: `3` whole (motioneval.js:191), `1` for a
    part (motion.js:96), and the inspector shows and resets to `1` for both
    (editschema.js:167).
  - **`t0` depends on the writer.** Only the `motion` verb gets a fold-stamped
    `t0`; a `comp`-written motion (every `motion:<part>`) without one anchors
    to whenever each client first evaluates it (motioneval.js:86-94), so two
    clients can disagree on its phase.
  - **Two spellings for a part motion**: `motion:<part>` keys or `motion`
    with `part` (motion.js:146).
  - **Provenance inside the data.** A reaction's `motion` entry carries
    `cause`/`by` in its args, and the fold stores args-minus-id, so they land
    in `comp.motion` (reactions.ts:58-59; fold.js:445); the lint lists them as
    known keys (server/lint.ts:34-40).
  - A motion on a **mounted** entity does nothing in the browser
    (motion.js:140). Text tier shows `in motion` only for the whole-entity
    key; part motions appear as `components: motion:<part>`
    (mcpl/agent.ts:3113, 3152).

### Reactions (`comp.reactions`)

- **Lives:** `comp.reactions = {<action>: {impulse}}` (PROTOCOL §4).
- **Written by:** `comp` only.
- **Read by:** the server on every `use` (server/reactions.ts:33-71): with
  `impulse`, and a whole-entity motion that is a pendulum or absent, it
  commits a `motion` as `world` with `{cause, by}`; any other shape is a
  `reaction-skip` in the flight recorder. Text tier: `reacts to: <actions>`
  (mcpl/agent.ts:3112). The browser only lists it (client/lib/scenegraph.js:68,
  editpanels.js:138).
- **Old/unknown client:** clients never evaluate it; they see the resulting
  `motion` entries.
- **Scars:** the only effect is the pendulum impulse; it pushes
  `comp.motion` only, so a part pendulum (`motion:<part>`) cannot be pushed.
  On an entity with no motion it starts a pendulum from defaults
  (reactions.ts:95-104). The new motion carries only pendulum keys, so a
  `part` on the old `comp.motion` is dropped (reactions.ts:96-104).

### Sockets (`comp.sockets`) and mounts (`parent`, `mounts`)

- **Lives:** `comp.sockets = {<slot>: {pos, yaw?, pose?, part?}}` in the
  model's local frame (PROTOCOL §4; client/lib/world.js:336-341). Mounts are
  not comps: an entity's `parent {to, slot?, offset?, yaw?}` and
  `state.mounts[<body>]` for avatars (shared/fold.js:455-484).
- **Written by:** `comp` (inspector merges one slot at a time into one
  `comp`, editschema.js:395-405; `+ seat…` is a viewport gesture,
  client/lib/seatedit.js); `mount`/`dismount` for the relation (server only
  checks that `to` exists, server/verbs.ts:269-279).
- **Read by:** browser body seating (`mountTransform`, world.js:380-414;
  client/lib/seats.js:58), entity cargo (`execMount`, realize/models.js:
  602-632), a sockets change re-seats riders (models.js:577-580); text tier
  (`sit/mount: <slots>`, mcpl/agent.ts:3111; seat pose :314, :913, :3006;
  mcpl/effective.ts:113); inspector (editschema.js:189-201).
- **Old/unknown client:** a slot that does not exist is not an error: the
  rider sits at the default point.
- **Scars:**
  - **The default point differs by rider.** A body on a missing slot sits at
    `[0, 0.5, 0]` (world.js:352, 387); cargo on a missing slot sits at
    `[0, 0, 0]` (models.js:619). The inspector's new slot is `[0, 0.5, 0]`
    (editschema.js:400).
  - The seat pose default `"sitchair"` is written in five places
    (world.js:414, seats.js:58, mcpl/agent.ts:314, 914, 3007,
    mcpl/effective.ts:113).
  - Cargo on a **part** socket is attached with `Object3D.attach`, which bakes
    the part's current swing phase into the offset (models.js:623-626) — the
    offset depends on when each client executed the mount.

### Particles (`comp.particles`)

- **Lives / fields:** `{preset, seed?, origin?, count?, size?, opacity?,
  speed?, lifetime?, area?, texture?, quality?}`; bounds and per-preset counts
  in shared/particles.js:25-77; `origin` clamped to ±8 (:141-155); seed
  derived from the entity id when absent (:131-137).
- **Written by:** `comp`; inspector (editschema.js:204-221, 406-414).
- **Read by:** browser `emitters.js` (bus listener :194-197, entity
  re-parenting :199-220); server lint (`particles-lint`, server/lint.ts:99);
  text tier description (`describeParticles`, mcpl/agent.ts:3119) and the
  one live sensory event among components (mcpl/agent.ts:1428-1443).
- **Old/unknown client:** an unknown preset still reads as an emitter and
  draws nothing (particles.js:170-176).
- **Scars:** the inspector's defaults are not the evaluator's. For an absent
  key it shows `count 150` whatever the preset (the preset's own count is
  70–420, particles.js:25-35), and `size`/`opacity`/`speed`/`lifetime` as `1`
  (editschema.js:209-216), while the renderer uses the preset's own look for
  an absent key (client/lib/emitters.js:108-111) — so a "reset to default"
  writes a value that can change the fire. The inspector's limits also differ
  from the bounds (`size` min 0.05 vs 0.005, `speed` min 0 vs 0.05, `lifetime`
  soft max 10 vs 30; editschema.js:213-216 vs particles.js:69-76). The
  sprite count is the one field allowed to differ between clients
  (particles.js:43-54).

### Picture (`comp.picture`)

- **Lives / fields:** `{src, part, look?, lit?: "scene"|"self", flip?}`;
  `src` a library path under `eidoverse/assets/` or `store/images/`, never a
  URL; `part` required (shared/picture.js:31-99).
- **Written by:** `comp`; inspector (editschema.js:224-241, 415-422).
- **Read by:** browser `pictures.js` (clones the part's material, never
  mutates the shared one; :63-136); text tier `describePicture`
  (mcpl/agent.ts:3122).
- **Old/unknown client:** an invalid bag reads `not shown: invalid
  declaration` in text tier and hangs nothing (picture.js:101-112,
  pictures.js:122-127).
- **Scars:** a picture needs a model part, so it means nothing on a light or
  a building. Every inspector edit (field or JSON) writes the NORMALIZED bag,
  so defaults (`lit: "scene"`, `flip: false`) become explicit bytes and
  unknown keys are dropped (editschema.js:450-457, 462-466; picture.js:81).
  The key `look` here is a description for text tier; the top-level comp
  `look` (below) is something else.

### Sound (`comp.sound`)

- **Lives / fields:** `{src, playing?, loop?, volume?, radius?, t0?, look?}`;
  defaults `playing true, loop true, volume 0.8, radius 12`
  (shared/sound.js:35); volume 0..1, radius 1..200 (:79-80).
- **Written by:** `comp`; inspector (editschema.js:245-262, 423-433), where
  `+ sound…` starts it paused (`playing: false`, editschema.js:425) and
  `play` stamps `t0`.
- **Read by:** browser `sounds.js` (one AudioContext, a panner per sound
  following the entity, :68-151); text tier `describeSound`
  (mcpl/agent.ts:3131).
- **Old/unknown client:** an invalid bag reads `not heard` in text tier and
  plays nothing (sound.js:99-107, sounds.js:113-114).
- **Scars:** `radius` becomes `PannerNode.maxDistance` under the `inverse`
  distance model (sounds.js:78, 81); maxDistance is where attenuation stops,
  and the graph has no other cutoff, so `radius` bounds the falloff rather
  than the audible range. `hidden` does not silence it (sounds.js has no
  hidden check). Without `t0` every client starts from the top (sound.js:
  82-86). Inspector writes are normalized, as for pictures.

### Structure (`comp.structure`)

- **Lives / fields:** `{tile?, wallH?, wallT?, slabT?, levels: [{y, tiles,
  walls, apertures}], labels?}`; defaults `tile 1, wallH 2.8, wallT 0.15,
  slabT 0.10` (shared/structure.js:56-61); total normalization, a malformed
  bag is an empty plan (:254-301).
- **Written by:** `comp`, from the Create panel's building tools
  (client/lib/structure_ui.js:98, 144), which start a building as a `spawn`
  of `eidoverse/assets/models/crate_large_red.glb` plus an empty structure
  (structure_ui.js:175-177).
- **Read by:** browser `realize/structure.js` (merged geometry and declared
  collider boxes, driven by fold entries, not the `comp` bus,
  :325-428); text tier `describeStructure` and "which room am I in"
  (mcpl/agent.ts:2486, 3042-3046, 3151).
- **Old/unknown client:** a client without the realizer shows the anchor
  crate.
- **Scars:**
  - **The anchor.** A building is a model entity whose model is hidden and
    whose collider is removed by the structure realizer, re-applied whenever
    the models realizer announces the object (realize/structure.js:283-304,
    417-421); removing the comp gives the crate back (:306-312).
  - The building is its own scene group placed from the FOLDED `pos`/`yaw`/
    `scale` (:189-194), and only `spawn`/`place`/`remove`/`comp` drive it
    (:376-401): a `motion` moves the hidden anchor, not the building, and a
    `mount` does not carry it.
  - `hidden: true` does not hide a building (the realizer has no hidden check;
    `applyHidden` acts on the already-hidden anchor, models.js:563-566), and
    removing the structure makes the anchor visible even if `hidden` is set
    (:311).

### Look-at (`comp.look`)

- **Lives / fields:** `{target: <entity id>}`.
- **Written by:** `comp`; the inspector's `ref` field (editschema.js:122-127,
  434-443).
- **Read by:** **nothing realizes it.** No browser module turns an entity to
  face its target, and text tier lists it only as `components: look`
  (mcpl/agent.ts:3152). It exists as the demonstrator for the inspector's
  `ref` field type (editschema.js:117-121).
- **Scars:** the name collides with the `look` description field inside
  `picture` and `sound`.

### Lock (`comp.lock`) and guard (`comp.guard`)

- **Lives:** `comp.lock = true`, `comp.guard = true`; `null` clears.
- **Written by:** `comp`; inspector Flags (editschema.js:108-115, 358-364).
  The guard itself is placer-gated whether on or off (server/rights.ts:
  159-161, 242-248).
- **Read by:** the server: lock refuses `place`, `punt`, cargo-`mount`,
  `remove`, same-id `spawn`/`light` for everyone (server/rights.ts:109-143);
  guard refuses authoring verbs from anyone but the placer, owner or an
  operator (rights.ts:146-253). Browser: the gizmo and drag/Del refuse a
  locked thing (client/lib/gizmo.js:55, client/lib/build.js:400, 406),
  editors mirror the guard (client/lib/placer.js:41). Text tier: `🔒 locked`,
  `🛡 guarded by <placer>` (mcpl/agent.ts:3134-3145).
- **Old/unknown client:** enforcement is server-side, so an old client's
  refused verb is answered by the door.
- **Scars:** both are read as truthy (`!!comp.lock`, rights.ts:141;
  `!!c.lock`, editschema.js:79), unlike `hidden` (strict `=== true`), so
  `comp.+ lock` in the inspector, which creates `{}`
  (editschema.js:446), locks the thing.

### Hidden (`comp.hidden`) and label (`comp.label`)

- **Lives:** `comp.hidden = true`; `comp.label = "<display name>"`.
- **Written by:** `comp`; inspector Flags (label trimmed and cut to 80
  chars, editschema.js:362).
- **Read by:** hidden: browser `applyHidden` sets the entity object's
  visibility (realize/models.js:563-566, also on create and placeholders,
  :99, :334, :445), text tier (mcpl/agent.ts:3146). Label: hierarchy and
  inspector (client/lib/editpanels.js:151-152, 177), text tier
  (mcpl/agent.ts:3104; mcpl/tools.ts:693, 723-725).
- **Scars:** hidden reaches only the entity's own object: not a building
  (above), not a sound.

### Captions (`comp.captions`) and stage (`comp.stage`)

- **Lives / fields:** `comp.captions = {session, n, gen, title?, mediaTime,
  window: [...] ≤ 20}` (AGENTS.md "captions"; shared/captions.js:62-68).
  `comp.stage = {speaker}`.
- **Written by:** captions only by the `caption` verb, folded by the
  sequencer (shared/fold.js:267-285); `comp` of that type is refused at the
  door and in the fold (server/verbs.ts:223-226, fold.js:431). Stage by
  `comp`.
- **Read by:** captions: text tier only (`describeCaptions`,
  mcpl/agent.ts:3127); no browser module renders `comp.captions`. Stage: only
  `tools/captionbot` (tools/captionbot/world.ts:113, 119), which copies the
  speaker into its captions.
- **Scars:** **a late-joining agent loses the captions.** The snapshot
  synthesizer emits every bag key as a `comp` entry (fold.js:607), the fold
  refuses `comp {type: "captions"}` (fold.js:431), and the mcpl agent joins
  by folding those synthetic entries (mcpl/agent.ts:696, 1218). Checked
  with a fold → `stateToEntries` → fold roundtrip: the folded bag
  `{captions: {...}}` comes back as no `comp` at all. The browser is not
  affected (it adopts the snapshot state directly, client/lib/state.js:76).

### Behavior bindings with `attach` (not on the entity)

- **Lives:** `state.behaviors[id] = {src, runtime?, attach?, caps?, knobs?,
  author, authorSub?, ts, state?}` (shared/fold.js:485-509); `attach` names
  an entity but nothing is written on it.
- **Written by:** `behavior` (server/verbs.ts:312-358): builder rank for the
  server runtime, owner for `runtime: "client"`; cap 12 per world,
  client offers included (:338-341).
- **Read by:** server sandbox host (server/behaviors.ts:365-385); browser
  mods panel for client offers (client/lib/mods.js:141-170, fed by
  client/lib/world.js:289-300 and realize/social.js:17-31).
- **Scars:** the knobs that make one script serve many things live on the
  binding, not on the entity. A client offer's `attach`/`caps`/`knobs` have
  no effect in the browser (mods.js:77-94). `world_debug {behaviors: true}`
  lists a client offer as `client-mod` (behaviors.ts:432-435) while
  `world_debug {behavior: <id>}` answers `not loaded yet` for it
  (behaviors.ts:423-427). The snapshot synthesizer re-emits a binding without
  its `attach` and `caps` (fold.js:619-621); the agent, its one in-tree
  live caller, passes `behaviors: false` (mcpl/agent.ts:114).

### Annotations (any other type)

- `recipe`, `notice` and anything else are legitimate annotations
  (AGENTS.md, "You may invent component types freely as annotation"); the
  inspector suggests them (editschema.js:282). They follow section 1 exactly.

## 3. Scars, in one list

- Mirrored pendulum math: server/reactions.ts:79-105 and
  client/lib/motioneval.js:99-102.
- Defaults written more than once: light (fold, lights.js, lightrig.js,
  editschema.js); seat pose `"sitchair"` (five places); sound (sound.js and
  the inspector's `+ sound` bag).
- Defaults that disagree: pendulum pivot (whole `[0,2,0]` vs part `[0,0,0]`);
  orbit radius (whole 3 / part 1 / inspector 1); socket point (body `[0,0.5,0]` vs cargo
  `[0,0,0]`); particle inspector defaults vs preset defaults.
- One field, two meanings: `look` (a comp that names a target; a description
  inside `picture`/`sound`); `motion` (whole entity, or a part when it
  carries `part`); `radius` on a sound (falloff bound, not audible range);
  `"(light)"` (a display name, not a `lib`).
- Writer-dependent data: `t0` stamped only for the `motion` verb; `cause`/`by`
  inside `comp.motion` only when a reaction wrote it.
- Components that need another component: `picture` and part motions need a
  model with named parts; `structure` needs an anchor model it then hides;
  a light cannot have a model.
- Things that do not travel with the entity's live transform: a building
  (ignores motion and mount); any motion on a mounted entity (browser).
- Truthiness differs: `lock`/`guard` truthy, `hidden` strictly `true`.
- Not on the record at all: inferred lamps (asset emissives); `collide` is
  on the record but browser-only.
- Snapshot roundtrip gaps: `captions` (refused on refold, so agents lose it);
  behavior `attach`/`caps` (no live consumer today).
- Known type with no realizer: `look`. Known types with no browser realizer:
  `captions` (text tier only), `stage` (tools/captionbot only), `reactions`
  (the server).
