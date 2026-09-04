// world-dreams #113 live-placement + fold-proof (2026-09-04). Usage: T=<join token> ME=hesperus-builder MODE=place|rebind|inspect PACE=450 bun tools/place-threshold-113.mjs
// A gate at the edge of the ignition grove's clearing that says nothing when you arrive and speaks once when you leave.
import fs from "fs";
const HTTP="http://127.0.0.1:8960", URL="ws://127.0.0.1:8960/ws", T=process.env.T, WORLD="staging";
const ME=process.env.ME||"hesperus-builder", MODE=process.env.MODE||"place", PACE=Number(process.env.PACE||450);
const SRC=fs.readFileSync("/home/claude/eido/staging/sdk/examples/thresholdkeeper.js","utf8");
const GATE={id:"gate1", lib:"eidoverse/assets/models/scifi_perimeter_wall_gate.glb", pos:[44.5,0,57.5], yaw:0, scale:1};  // clearing edge, toward the unsought orb (46,52)
const INSCR={title:"The Threshold — world-dreams #113",
 text:`A gate that says nothing when you arrive and speaks once when you leave — handing back the last thing you said inside, to carry out. "It suffices him that again and again he may set foot on the threshold of the sanctuary in which he could never tarry. Indeed, having to leave it again and again is for him an intimate part of the meaning." — Buber, I and Thou, p. 50. Stand in the clearing a while, say something, walk away.`};
const ws=new WebSocket(URL); const msgs=[]; const errors=[]; let snap=null;
const send=o=>ws.send(JSON.stringify(o)); const verb=(v,a)=>send({type:"verb",verb:v,args:a}); const settle=ms=>new Promise(r=>setTimeout(r,ms));
const pverb=async(v,a)=>{verb(v,a); await settle(PACE);};
ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); msgs.push(m); if(m.type==="snapshot")snap=m; if(m.type==="error"){errors.push(m.error);console.log("  ✗ error:",m.error);}};
ws.onopen=()=>send({type:"join",token:T,id:ME,world:WORLD});
await new Promise(r=>{const iv=setInterval(()=>{if(snap){clearInterval(iv);r();}},30)});
console.log("joined as",snap.you,"| rights:",JSON.stringify(snap.yourRights));
send({type:"pose",pose:{p:[43,0,65],yaw:0,speed:0,clip:"idle",pitch:0}}); await settle(200);
const req=(msg,id)=>{send({...msg,reqId:id}); return new Promise(res=>{const iv=setInterval(()=>{const m=msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});};
const eye=async()=>{const w=new WebSocket(URL); return await new Promise(res=>{w.onopen=()=>w.send(JSON.stringify({type:"join",token:T,id:"eye-113",world:WORLD,spectate:true})); w.onmessage=ev=>{const m=JSON.parse(String(ev.data)); if(m.type==="snapshot"){w.close(); const e=((m.state&&m.state.entities)||m.entities||{})[GATE.id]; res({there:!!e,lib:e?.lib?.split("/").pop(),pos:e?.pos,locked:!!e?.comp?.lock,inscr:!!e?.comp?.inscription});}};});};
if(MODE==="inspect"){ console.log("FOLD:",JSON.stringify(await eye())); const r=await req({type:"debug",behaviors:true},"r1"); console.log("roster:",JSON.stringify(r.events?.filter(e=>/threshold/.test(e.id)))); process.exit(0); }
const up=await fetch(`${HTTP}/upload?as=script&token=${T}&by=${ME}`,{method:"POST",body:SRC}); const path=JSON.parse(await up.text()).path; console.log("upload:",up.status,path);
if(MODE==="place"){
  await pverb("spawn",{id:GATE.id,lib:GATE.lib,pos:GATE.pos,yaw:GATE.yaw,scale:GATE.scale});
  await pverb("comp",{id:GATE.id,type:"inscription",data:INSCR});
  await pverb("comp",{id:GATE.id,type:"lock",data:true});
}
await pverb("behavior",{id:"threshold-gate",src:path,attach:GATE.id,caps:{verbs:["say"]}});
await settle(1500);
console.log("FOLD:",JSON.stringify(await eye()));
const r=await req({type:"debug",behaviors:true},"r1"); console.log("roster:",JSON.stringify((r.events||[]).filter(e=>/threshold/.test(e.id))));
const ring=await req({type:"debug",behavior:"threshold-gate"},"r2"); console.log("ring:",JSON.stringify((ring.events||[]).slice(-3)));
console.log("errors:",errors.length?errors:"none"); process.exit(errors.length?3:0);
