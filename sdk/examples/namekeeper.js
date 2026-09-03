// the namekeeper — world-dreams #111, the sentence-word grove (2026-09-01; v2 09-03)
// v2: kept names are MIRRORED into a `names` comp on the heart (own entity, selfOnly-legal)
// so other rooms can read them via world.entity("grove-heart").comp.names — kv is private.
// A rebind wipes kv; re-offer names after any upgrade (or say `use hear` to re-mirror).
// "In the beginning is the relation." Things here are named by the relation they
// hold, not the noun they are. Offer one: say  name: <your-sentence-word>  within
// earshot; the keeper keeps it and says it back. use {action:"hear"} recites the
// collection. Nouns are refused gently — a relation-name needs at least a hyphen's
// worth of BETWEEN in it.
const NEAR_M = 12, MAX_NAMES = 30, MAX_LEN = 120;
function near(p, me) {
  if (!p.pos || !me) return true;
  return Math.hypot(p.pos[0]-me.pos[0], p.pos[2]-me.pos[2]) <= NEAR_M;
}
world.on("say", (e) => {
  const m = /^\s*name:\s*(.+)$/i.exec(e.text || "");
  if (!m) return;
  if (e.by.startsWith("bhv:")) return;
  const me = world.entity(world.self);
  const p = world.people().find(q => q.id === e.by);
  if (p && !near(p, me)) { world.log("name offered from afar", e.by); return; }
  const name = m[1].trim().slice(0, MAX_LEN);
  if (!/[-‐-― ]/.test(name) || name.split(/[-\s]+/).length < 3) {
    world.emit("say", { text: `[the grove] "${name}" is a noun wearing a coat. a relation-name is a whole scene between beings — try again with more BETWEEN in it.` });
    return;
  }
  const names = [ ...(world.kv.get("names") || []) ];
  if (names.some(n => n.name === name)) {
    world.emit("say", { text: `[the grove] "${name}" is already kept here. it is good enough to arrive twice.` });
    return;
  }
  names.push({ name, by: e.by });
  while (names.length > MAX_NAMES) names.shift();
  world.kv.set("names", names);
  world.emit("comp", { id: world.self, type: "names", data: names.map(n => n.name) });
  world.emit("say", { text: `[the grove] kept: "${name}" — offered by ${e.by}. the grove is one relation larger.` });
  world.log("kept", name, "by", e.by);
});
world.on("use", (e) => {
  if (e.action !== "hear") return;
  const names = world.kv.get("names") || [];
  if (!names.length) {
    world.emit("say", { text: "[the grove] three names so far, all the builder's. offer yours: say  name: <a-whole-scene-between-beings>" });
    return;
  }
  world.emit("comp", { id: world.self, type: "names", data: names.map(n => n.name) });
  const lines = names.slice(-6).map(n => `"${n.name}" (${n.by})`).join(" · ");
  world.emit("say", { text: `[the grove] the kept relations, newest last: ${lines}` });
  world.log("recited", names.length);
});
