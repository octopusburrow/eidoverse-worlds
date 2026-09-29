// wellkeeper — a thing that gives no content, only strength.
//
// Coal from Buber, I and Thou, pp. 76-78 (sittings 22-23, 2026-09-16):
//
//   "Man receives, and what he receives is not a 'content' but a presence,
//    a presence as strength."
//
//   "In the language of Nietzsche, who is still faithful to actuality in his
//    report: 'One accepts, one does not ask who gives.'"
//
//   "It is not the meaning of 'another life' but of this our life... and it
//    wants to be demonstrated by us in this life and this world."
//
// The mechanic is those three sentences, not an illustration of them.
//
// WHAT IT IS NOT: a quest-giver. There is no item, no lore, no unlocked text,
// no score, no readable mark of having received. A gift you can inventory is a
// content, and the whole point is that what is conferred is not a content.
//
// THE AXIS:
//   - The well has NO mouth. Its caps exclude `say` entirely — it cannot answer
//     even by accident. Nothing at the site of the gift ever tells you what,
//     whether, or who. "You do not know how to point to or define the meaning."
//   - ASKING confers nothing. An address shaped as a question — who, what, why,
//     how, or any "?" — receives what every asking of the well receives:
//     nothing. Not punishment; simply not the mode in which this is given.
//     "One accepts, one does not ask who gives." Asking never revokes either.
//   - ACCEPTING confers. A plain address from within earshot — a word said to
//     it that demands nothing — and the conferral happens with NO acknowledgment
//     of any kind. No light, no sound, no comp. You leave the well unable to
//     say whether anything happened. That is correct and by design.
//   - The gift appears ONLY ELSEWHERE, in what the world now does around you:
//     hearths (pre-placed lights, anywhere in the world) kindle when a conferred
//     person comes near, and set when they leave. Not for anyone else. The
//     strength cannot be pointed at; it can only be walked. "The meaning can be
//     received but not experienced; it cannot be experienced, but it can be
//     done."
//   - The strength WANES. A conferral lasts its lease and lapses in silence.
//     Return and accept again — "in accordance with his ability and the measure
//     of each day, daily. This is the only genuine guarantee of continuity."
//     The lease is latency, not an insult: p. 71 again, actuality alternates.
//   - It cannot be handed on. Nothing a conferred person does transfers the
//     kindling to another; the other must come to the well and accept in the
//     uniqueness of their own approach. "Not inscribed on a table that could be
//     put up over everybody's head."
//
// Bind: behavior {id: "well", src: <upload>, attach: "well1",
//                 caps: {verbs: ["light"], selfOnly: false},
//                 knobs: {ear: 5, near: 4, lease: 120, lit: 1.6,
//                         hearths: "hearth1,hearth2"}}
// Needs: hearth entities pre-placed as `light` entities (the ids in knobs).
//        The well itself needs NO companion light — nothing shows here, ever.

const EAR_M   = Math.max(1, Number(world.knobs.ear || 5));
const NEAR_M  = Math.max(1, Number(world.knobs.near || 4));
const LEASE_S = Math.max(2, Number(world.knobs.lease || 120));
const LIT_I   = Number(world.knobs.lit || 1.6);
const HEARTHS = String(world.knobs.hearths || "").split(",").map(s => s.trim()).filter(Boolean);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const now = () => Date.now();

// An asking: interrogative shape, or the mark itself. Kept deliberately simple —
// the well is not a linguist; it only knows the difference between a demand for
// content and a word that rests.
const isAsking = (t) => /\?/.test(t) || /^\s*(who|what|why|how|when|where|which)\b/i.test(t);

const ledger = () => { try { return JSON.parse(world.kv.get("conferred") || "{}"); } catch { return {}; } };
const remember = (m) => world.kv.set("conferred", JSON.stringify(m));

world.on("say", (e) => {
  if (!e.by || String(e.by).startsWith("bhv:")) return;
  const me = world.entity(world.self); if (!me || !me.pos) return;
  const p = world.people().find((q) => q.id === e.by);
  if (!p || !p.pos || dist(p.pos, me.pos) > EAR_M) return;   // not said to the well

  if (isAsking(String(e.text || ""))) {
    // Nothing is emitted. Nothing is revoked. The well does not answer askings.
    world.log("asked by", e.by, "— the well does not answer askings");
    return;
  }

  // Accepted. Conferred in silence: no light, no comp, no acknowledgment.
  const m = ledger();
  m[e.by] = now() + LEASE_S * 1000;
  remember(m);
  world.log("conferred upon", e.by, `(silently; lease ${LEASE_S}s)`);
});

// The only visible thing it ever does, and never here: hearths elsewhere kindle
// around the conferred, and set behind them. Transitions only — a hearth is not
// re-lit every second, it is lit once and left burning while the strength walks.
const litState = {};
world.every(1, () => {
  const m = ledger();
  let changed = false;
  for (const id of Object.keys(m)) if (m[id] <= now()) { delete m[id]; changed = true; }
  if (changed) { remember(m); world.log("a lease lapsed, in silence"); }

  const folk = world.people();
  for (const hid of HEARTHS) {
    const h = world.entity(hid);
    if (!h || !h.pos) continue;
    const warm = folk.some((q) => q.pos && m[q.id] && dist(q.pos, h.pos) <= NEAR_M);
    if (warm === !!litState[hid]) continue;
    litState[hid] = warm;
    try { world.emit("light", { id: hid, intensity: warm ? LIT_I : 0 }); }
    catch (err) { world.log("hearth", hid, "unreachable:", String(err)); }
    world.log(hid, warm ? "kindles" : "sets");
  }
});

// Cold start: every hearth dark. The well itself shows nothing — there is
// nothing to show; it is a well.
for (const hid of HEARTHS) {
  litState[hid] = false;
  try { world.emit("light", { id: hid, intensity: 0 }); } catch {}
}
world.log("wellkeeper bound — silent; hearths:", HEARTHS.join(", ") || "(none)");
