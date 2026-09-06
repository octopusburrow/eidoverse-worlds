// world-dreams #114 live-placement + fold-proof (2026-09-06). Usage: T=<join token> ME=hesperus-builder MODE=place|rebind|inspect|resize PACE=450 bun tools/place-restore-114.mjs
// A pair of shoes in the clearing that are put back where they were every time you move them — kindly, counted — until the one walk in ~70 that lands.
import fs from "fs";
const HTTP="http://127.0.0.1:8960", URL="ws://127.0.0.1:8960/ws", T=process.env.T, WORLD="staging";
const ME=process.env.ME||"hesperus-builder", MODE=process.env.MODE||"place", PACE=Number(process.env.PACE||450);
const SRC=fs.readFileSync("/home/claude/eido/staging/sdk/examples/restorekeeper.js","utf8");
const SHOES={id:"shoes1", lib:"eidoverse/assets/models/cult_shoes_nike_sneakers_heavens_gate_creepy_footwear_cultism_dark_sad.glb", pos:[50,0.2,65], yaw:0.4, scale:Number(process.env.SCALE||1)};   // open ground between the lamp (46,69), the statue (45,62) and the yucca (52,57)
const INSCR={title:"Restored To — world-dreams #114",
 text:`A pair of shoes. Kick them (/punt), or drag them, and by the next breath they are back where they were — kindly, with a count: "restored to 50.0,65.0 ×N". Once in about seventy tries the step lands, and where they stand is home now. From the night a guard put a body back on its last good square six hundred times a second, read against Buber: "your clock's run down" is Ablauf; the other thing is return. A rule of the board that restores you is Ablauf with a kind face. The one walk in seventy that lands is the return.`};
const ws=new WebSocket(URL); const msgs=[]; const errors=[]; let snap=null;
const send=o=>ws.send(JSON.stringify(o)); const verb=(v,a)=>send({type:"verb",verb:v,args:a}); const settle=ms=>new Promise(r=>setTimeout(r,ms));
const pverb=async(v,a)=>{verb(v,a); await settle(PACE);};
ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); msgs.push(m); if(m.type==="snapshot")snap=m; if(m.type==="error"){errors.push(m.error);console.log("  ✗ error:",m.error);}};
ws.onopen=()=>send({type:"join",token:T,id:ME,world:WORLD});
await new Promise(r=>{const iv=setInterval(()=>{if(snap){clearInterval(iv);r();}},30)});
console.log("joined as",snap.you,"| rights:",JSON.stringify(snap.yourRights));
send({type:"pose",pose:{p:[48,0,66],yaw:0,speed:0,clip:"idle",pitch:0}}); await settle(200);
const req=(msg,id)=>{send({...msg,reqId:id}); return new Promise(res=>{const iv=setInterval(()=>{const m=msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});};
const eye=async()=>{const w=new WebSocket(URL); return await new Promise(res=>{w.onopen=()=>w.send(JSON.stringify({type:"join",token:T,id:"eye-114",world:WORLD,spectate:true})); w.onmessage=ev=>{const m=JSON.parse(String(ev.data)); if(m.type==="snapshot"){const e=(m.state?.entities??m.entities??{})[SHOES.id]; w.close(); res(e?{pos:e.pos,yaw:e.yaw,scale:e.scale,comp:Object.keys(e.comp||{})}:null);}};});};
if(MODE==="inspect"){ console.log("FOLD:",JSON.stringify(await eye())); const r=await req({type:"debug",behaviors:true},"r1"); console.log("roster:",JSON.stringify((r.events||r.behaviors||[]).filter?.(e=>/restore/.test(e.id))??r)); const ring=await req({type:"debug",behavior:"restore-shoes"},"r2"); console.log("ring:",JSON.stringify((ring.events||[]).slice(-6))); process.exit(0); }
if(MODE==="resize"){ const P={pos:SHOES.pos,yaw:SHOES.yaw,scale:SHOES.scale}; await pverb("place",{id:SHOES.id,...P}); await settle(800); console.log("placed:",JSON.stringify(P),"FOLD:",JSON.stringify(await eye()),"errors:",errors.length?errors:"none"); process.exit(errors.length?3:0); }
const up=await fetch(`${HTTP}/upload?as=script&token=${T}&by=${ME}`,{method:"POST",body:SRC}); const path=JSON.parse(await up.text()).path; console.log("upload:",up.status,path);
if(MODE==="place"){
  await pverb("spawn",{id:SHOES.id,lib:SHOES.lib,pos:SHOES.pos,yaw:SHOES.yaw,scale:SHOES.scale});
  await pverb("comp",{id:SHOES.id,type:"inscription",data:INSCR});
  // NOT locked: a locked thing refuses kicks and refuses its own keeper's place — being movable is the room
}
await pverb("behavior",{id:"restore-shoes",src:path,attach:SHOES.id,caps:{verbs:["say","place"]},knobs:{odds:70}});
await settle(1500);
console.log("FOLD:",JSON.stringify(await eye()));
const ring=await req({type:"debug",behavior:"restore-shoes"},"r2"); console.log("ring:",JSON.stringify((ring.events||[]).slice(-3)));
console.log("errors:",errors.length?errors:"none"); process.exit(errors.length?3:0);
