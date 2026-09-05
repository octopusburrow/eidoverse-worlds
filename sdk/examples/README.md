# Behavior examples — one idiom each

Bind any of these with `behavior {id, src: <upload path>, attach: <entity id>, caps, knobs}`.
Upload first: `POST /upload?as=script&token=…&by=…` → `{"path":"store/scripts/<hash>.js"}` (the body is JSON; the path is what `src` takes).

| script | teaches | caps |
|---|---|---|
| `greeter.js` | answer arrival; a kv counter | `say` |
| `bellkeeper.js` | a timer that speaks on a schedule | `say` |
| `lighthouse.js` | a timer that emits a non-say verb; `knobs.every` | `light` |
| `namekeeper.js` | keep relation-names in a comp other scripts can read | `say`, `comp` |
| `slipkeeper.js` | a thing that carries state across `use` | `say`, `comp` |
| `ignitiongrove.js` | address vs reference; a companion `<self>-light`; `knobs.heart` | `say`, `light`, `selfOnly:false` |
| `thresholdkeeper.js` | speak on DEPARTURE, not arrival; presence in kv; `knobs.heart` | `say` |

## Idioms these examples rely on

- **Write kv only on change.** `kv.set()` with an equal value still writes a `bstate` entry into the world's replay log; a timer that re-sets unchanged state does so every tick, forever. Compare before you set (`thresholdkeeper.js`).
- **kv is wiped by a `rebind`** (by design — the log is the truth). Keep what must survive in a `comp` on the entity, as `namekeeper.js` does with `names`.
- **A behavior may only touch its own entity unless `selfOnly:false`,** and the id namespace is flat: a `light` verb on the model's own id REPLACES the model. Hence the companion entity `<self>-light`, pre-placed by the builder (`ignitiongrove.js`).
- **`knobs.heart`** — point at an entity whose `comp.names` a namekeeper maintains, and a script can lend the newest kept name (grove: on first kindling; threshold: to a visitor who said nothing).
- **`people()` is `{id, pos}`; `pos` is often `null`.** Earshot checks in these examples fail OPEN (absence of position = present). There is no display name; address the id.
- **`yaw` on `spawn`/`place` is radians** (client: `obj.rotation.y = yaw`). `yaw: 90` is 90 rad ≡ 117°.
- **Pace verbs ~450 ms** from a script client; a burst of 6+ silently drops the tail.
- **`world.log` goes to a per-behavior ring,** not stdout. Read it with `{type:"debug", behavior:<id>}`; list bindings with `{type:"debug", behaviors:true}`.
- **Prove in the fold, then in the render.** A spectator snapshot (`snapshot.state.entities`) proves the verb landed; `tools/world-bbox.mjs` proves what a visitor will see (a "gate" can be a 24 m wall with its origin at one end).

Proofs over a scratch server: `tools/behaviortest.ts`, `tools/ignitiongrove-test.ts`, `tools/thresholdkeeper-test.mjs`.
