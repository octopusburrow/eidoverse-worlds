// namekeeper — a grove that keeps RELATION-names and says them back.
// Bind:  behavior {id: "names", src: <upload>, attach: "grove-heart"}
// Offer: say  name: <a-whole-scene-between-beings>  within earshot; nouns are refused.
// Hear:  use {id: "grove-heart", action: "hear"} recites the kept names.
// Kept names are mirrored into a `names` comp on the attached entity so neighbours
// can read them (kv is private, and a rebind starts kv empty).
// "In the beginning is the relation." Things here are named by the relation they
// hold, not the noun they are. Offer one: say  name: <your-sentence-word>  within
// earshot; the keeper keeps it and says it back. use {action:"hear"} recites the
// collection. Nouns are refused gently — a relation-name needs at least a hyphen's
// worth of BETWEEN in it.
const NEAR_M = 12, MAX_NAMES = 20, MAX_LEN = 120, MAX_BY = 16, KV_BUDGET = 6000; // the store caps at 8 KB and `names` is the only key here
function near(p, me) {
  if (!p.pos || !me?.pos) return true;
  return Math.hypot(p.pos[0]-me.pos[0], p.pos[2]-me.pos[2]) <= NEAR_M;
}
world.on("say", (e) => {
  const m = /^\s*name:\s*(.+)$/i.exec(e.text || "");
  if (!m) return;
  if (e.by.startsWith("bhv:")) return; // belt-and-braces; the server already drops bhv:* actors
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
  names.push({ name, by: String(e.by).slice(0, MAX_BY) });
  while (names.length > MAX_NAMES || JSON.stringify(names).length > KV_BUDGET) names.shift();
  world.kv.set("names", names);
  world.emit("comp", { id: world.self, type: "names", data: names.map(n => n.name) });
  world.emit("say", { text: `[the grove] kept: "${name}" — offered by ${e.by}. the grove is one relation larger.` });
  world.log("kept", name, "by", e.by);
});
world.on("use", (e) => {
  if (e.action !== "hear") return;
  const names = world.kv.get("names") || [];
  if (!names.length) {
    world.emit("say", { text: "[the grove] no names kept yet. offer one: say  name: <a-whole-scene-between-beings>" });
    return;
  }
  world.emit("comp", { id: world.self, type: "names", data: names.map(n => n.name) });
  const lines = names.slice(-6).map(n => `"${n.name}" (${n.by})`).join(" · ");
  world.emit("say", { text: `[the grove] the kept relations, newest last: ${lines}` });
  world.log("recited", names.length);
});
