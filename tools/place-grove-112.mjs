// world-dreams #112 live-placement + fold-proof (2026-09-03). Usage: T=<join token> ME=hesperus-builder MODE=place|finish|rebind|unlock-lights|test PACE=450 bun tools/place-grove-112.mjs
// PACE matters: the world rate-limits verbs per client; a burst of 6+ silently drops the tail (comps/binds) — pace ~450ms.
// #112 live-place: upload v4 → spawn 3 things + 3 companion lights → inscriptions + locks → bind ×3 → prove in the FOLD.
import fs from "fs";
const HTTP="http://127.0.0.1:8960", URL="ws://127.0.0.1:8960/ws", T=process.env.T, WORLD="staging";
const ME=process.env.ME||"hesperus", MODE=process.env.MODE||"place";  // MODE=place | test | inspect
const SRC=fs.readFileSync("/home/claude/eido/staging/sdk/examples/ignitiongrove.js","utf8");
const M="eidoverse/assets/models/";
// the clearing: NW of the sentence-word grove (52–55,57–60), N of the unsought orb (46,52). Triangle ~7m a side, centre ≈ (43,65).
const THINGS=[
 {id:"statue1",  lib:M+"jeoffry.glb",                                          pos:[45,0,62],   yaw:220, scale:3,    light:{pos:[45,1.6,62],  color:0xffe3b8, range:9}},
 {id:"fountain1",lib:M+"apocalyptic_destroyed_rubble_debris_pile_ruins.glb",   pos:[39.5,0,67], yaw:30,  scale:0.55, light:{pos:[39.5,1.8,67],color:0x7fc4ff, range:10}},
 {id:"lamp1",    lib:M+"streetlight_lamp_light_street_blade_runner_cyberpunk.glb", pos:[46,0,69], yaw:200, scale:1,  light:{pos:[46,2.5,68.6],color:0xffb27a, range:9}},
];
const INSCR=(label)=>({title:`The Ignition Grove — world-dreams #112 (${label})`,
 text:`Three things that are scenery as long as you speak ABOUT them, and catch fire the instant you speak TO them. "All response binds the You into the It-world... and the object shall catch fire and become present." — Buber, I and Thou, Second Part p.44. Address them (you / hello / a question / an imperative) within ~10m; refer to them ("the lamp", "it") and they stay frozen — reference beats pronoun. The fire cools on its own; presence was never storable. Read 09-02, placed 09-03 (Fable 5.1's first night).`});

const ws=new WebSocket(URL); const msgs=[]; const errors=[]; let snap=null;
const send=o=>ws.send(JSON.stringify(o)); const verb=(v,a)=>send({type:"verb",verb:v,args:a});
const settle=ms=>new Promise(r=>setTimeout(r,ms));
ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); msgs.push(m); if(m.type==="snapshot")snap=m; if(m.type==="error"){errors.push(m.error);console.log("  ✗ error:",m.error);} };
ws.onopen=()=>send({type:"join",token:T,id:ME,world:WORLD});
await new Promise(r=>{const iv=setInterval(()=>{if(snap){clearInterval(iv);r();}},30)});
console.log("joined as",snap.you,"| present:",JSON.stringify(snap.present).slice(0,200),"| rights:",JSON.stringify(snap.yourRights));
const rights=snap.yourRights||{}; const can=v=>Array.isArray(rights)?rights.includes(v):(rights[v]??rights.verbs?.includes?.(v)??rights.build??rights.role);
if(MODE==="inspect"){ process.exit(0); }
// stand in the clearing so near() is satisfied and /snap has a body to follow
const pose=(p,yaw)=>send({type:"pose",pose:{p,yaw,speed:0,clip:"idle",pitch:0}});
pose([43,0,65],0); await settle(200);

const PACE=Number(process.env.PACE||450);
const pverb=async(v,a)=>{verb(v,a); await settle(PACE);};
if(MODE==="dayfalse"){
  for(const t of THINGS) await pverb("light",{id:t.id+"-light",day:false});
  console.log("lights set day:false; errors:",errors.length?errors:"none"); process.exit(errors.length?3:0);
}
if(MODE==="unlock-lights"){
  for(const t of THINGS) await pverb("comp",{id:t.id+"-light",type:"lock",data:null});
  console.log("lights unlocked; errors:",errors.length?errors:"none");
}
if(MODE==="rebind"){
  const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=${ME}`,{method:"POST",body:SRC});
  const path=JSON.parse(await r.text()).path; console.log("upload:",r.status,path);
  for(const t of THINGS) await pverb("behavior",{id:"grove-"+t.id.replace(/\d+$/,""),src:path,attach:t.id,caps:{verbs:["say","light"],selfOnly:false}});
  await settle(1500); console.log("rebound; errors:",errors.length?errors:"none");
}
if(MODE==="finish"){
  const path=process.env.SRC_PATH; if(!path){console.log("SRC_PATH required");process.exit(2);}
  for(const t of THINGS){
    await pverb("comp",{id:t.id,type:"inscription",data:INSCR(t.id.replace(/\d+$/,""))});
    await pverb("comp",{id:t.id,type:"lock",data:true});
    await pverb("comp",{id:t.id+"-light",type:"lock",data:true});
  }
  for(const t of THINGS){
    await pverb("behavior",{id:"grove-"+t.id.replace(/\d+$/,""),src:path,attach:t.id,caps:{verbs:["say","light"],selfOnly:false}});
  }
  await settle(1500);
  console.log("errors so far:",errors.length?errors:"none");
}
if(MODE==="place"){
  const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=${ME}`,{method:"POST",body:SRC});
  const path=(await r.text()).trim(); console.log("upload:",r.status,path); if(!r.ok)process.exit(2);
  for(const t of THINGS){
    verb("spawn",{id:t.id,lib:t.lib,pos:t.pos,yaw:t.yaw,scale:t.scale});
    verb("light",{id:t.id+"-light",pos:t.light.pos,color:t.light.color,intensity:0.6,range:t.light.range,keep:true,day:false});
  }
  await settle(600);
  for(const t of THINGS){
    verb("comp",{id:t.id,type:"inscription",data:INSCR(t.id.replace(/\d+$/,""))});
    verb("comp",{id:t.id,type:"lock",data:true});
    verb("comp",{id:t.id+"-light",type:"lock",data:true});
  }
  await settle(400);
  for(const t of THINGS){
    verb("behavior",{id:"grove-"+t.id.replace(/\d+$/,""),src:path,attach:t.id,caps:{verbs:["say","light"],selfOnly:false}});
  }
  await settle(1500);
  console.log("errors so far:",errors.length?errors:"none");
}

// ---- prove it in the fold: refer (must stay frozen), then address (must kindle + light entity intensity 15)
const eye=async()=>{ // fresh spectator snapshot = the FOLD, not the log
  const w=new WebSocket(URL); const got=await new Promise(res=>{w.onopen=()=>w.send(JSON.stringify({type:"join",token:T,id:"eye-grove-fold",world:WORLD,spectate:true})); w.onmessage=e=>{const m=JSON.parse(String(e.data)); if(m.type==="snapshot"){res(m.state);w.close();}};});
  const E=got.entities; const out={};
  for(const t of THINGS){const L=E[t.id+"-light"]; out[t.id]={there:!!E[t.id],lib:E[t.id]?.lib?.split("/").pop(),scale:E[t.id]?.scale,locked:!!E[t.id]?.comp?.lock,inscr:!!E[t.id]?.comp?.inscription,light:L?{i:L.intensity,c:L.color?.toString(16),keep:L.keep}:null,bhv:got.behaviors?.["grove-"+t.id.replace(/\d+$/,"")]?.attach};}
  return out;
};
console.log("FOLD before test:",JSON.stringify(await eye(),null,0));
const bhvSays=()=>msgs.filter(m=>m.type==="log"&&m.entry?.verb==="say"&&String(m.entry.actor||"").startsWith("bhv:")).map(m=>`${m.entry.actor}: ${m.entry.args.text.slice(0,90)}`);
const mark=msgs.length;
await settle(PACE); verb("say",{text:"did you see the lamp? the statue is beautiful."}); await settle(1500);
console.log("after REFER — bhv says:",JSON.stringify(bhvSays().slice(-3)),"| light intensities:",JSON.stringify(Object.fromEntries(Object.entries(await eye()).map(([k,v])=>[k,v.light?.i]))));
await settle(PACE); verb("say",{text:"hello. are you cold?"}); await settle(3000);
console.log("after ADDRESS — bhv says:",JSON.stringify(bhvSays().slice(-4)));
const after=await eye(); console.log("FOLD after address:",JSON.stringify(Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.light]))));
console.log("log msg types:",JSON.stringify([...new Set(msgs.slice(mark).map(m=>m.type+":"+(m.entry?.verb||"")))]));
process.exit(errors.length?3:0);
