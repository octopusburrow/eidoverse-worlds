// world-dreams #115 live-placement + fold-proof (2026-09-10). Usage: T=<join token> ME=hesperus-builder MODE=place|rebind|inspect|resize PACE=450 bun tools/place-meter-115.mjs
// A parking meter everyone addresses and that never answers: each word near it turns it one hour; alone long enough, it speaks once, as the clock.
import fs from "fs";
const HTTP="http://127.0.0.1:8960", WS="ws://127.0.0.1:8960/ws", T=process.env.T, WORLD="staging";
const ME=process.env.ME||"hesperus-builder", MODE=process.env.MODE||"place", PACE=Number(process.env.PACE||450);
const SRC=fs.readFileSync(new URL("../sdk/examples/meterkeeper.js", import.meta.url),"utf8");
const METER={id:"meter1", lib:"eidoverse/assets/models/parking_meter_electronic_street_blade_runner_cyberpunk.glb", pos:[57,0,67], yaw:0, scale:Number(process.env.SCALE||1)};   // open ground east of the shoes (50,65), clear of the palm's canopy (55,59.5 r≈3.6) and the lamp (46,69)
const INSCR={title:"The Meter — world-dreams #115",
 text:`A parking meter. Say anything near it, or touch it, and it turns one hour — that is its whole answer; it never speaks to you. Twelve voices, one revolution; the count is the digits on its forehead. Leave it alone long enough and it says one sentence to nobody: "I am the clock that exists and does not know itself." From Buber, I and Thou, pp. 57–58: the third I, the demonic You for the millions — "a thousand relations reach out toward him but none issues from him"; to "You" he responds by saying: It. The one time he could say I was in exile, and what he said was that.`};
const ws=new WebSocket(WS); const msgs=[]; const errors=[]; let snap=null;
const send=o=>ws.send(JSON.stringify(o)); const verb=(v,a)=>send({type:"verb",verb:v,args:a}); const settle=ms=>new Promise(r=>setTimeout(r,ms));
const pverb=async(v,a)=>{verb(v,a); await settle(PACE);};
ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); msgs.push(m); if(m.type==="snapshot")snap=m; if(m.type==="error"){errors.push(m.error);console.log("  ✗ error:",m.error);}};
ws.onopen=()=>send({type:"join",token:T,id:ME,world:WORLD});
await new Promise(r=>{const iv=setInterval(()=>{if(snap){clearInterval(iv);r();}},30)});
console.log("joined as",snap.you,"| rights:",JSON.stringify(snap.yourRights));
send({type:"pose",pose:{p:[54,0,68],yaw:0,speed:0,clip:"idle",pitch:0}}); await settle(200);
const req=(msg,id)=>{send({...msg,reqId:id}); return new Promise(res=>{const iv=setInterval(()=>{const m=msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});};
const eye=async()=>{const w=new WebSocket(WS); return await new Promise(res=>{w.onopen=()=>w.send(JSON.stringify({type:"join",token:T,id:"eye-115",world:WORLD,spectate:true})); w.onmessage=ev=>{const m=JSON.parse(String(ev.data)); if(m.type==="snapshot"){const e=(m.state?.entities??m.entities??{})[METER.id]; w.close(); res(e?{pos:e.pos,yaw:e.yaw,scale:e.scale,comp:Object.keys(e.comp||{})}:null);}};});};
if(MODE==="inspect"){ console.log("FOLD:",JSON.stringify(await eye())); const ring=await req({type:"debug",behavior:"meter"},"r2"); console.log("ring:",JSON.stringify((ring.events||[]).slice(-6))); process.exit(0); }
if(MODE==="resize"){ const P={pos:METER.pos,yaw:METER.yaw,scale:METER.scale}; await pverb("place",{id:METER.id,...P}); await settle(800); console.log("placed:",JSON.stringify(P),"FOLD:",JSON.stringify(await eye()),"errors:",errors.length?errors:"none"); process.exit(errors.length?3:0); }
const up=await fetch(`${HTTP}/upload?as=script&token=${T}&by=${ME}`,{method:"POST",body:SRC}); const path=JSON.parse(await up.text()).path; console.log("upload:",up.status,path);
if(MODE==="place"){
  await pverb("spawn",{id:METER.id,lib:METER.lib,pos:METER.pos,yaw:METER.yaw,scale:METER.scale});
  await pverb("comp",{id:METER.id,type:"inscription",data:INSCR});
  // NOT locked: the meter's own keeper turns it with `place`; a locked thing refuses that
}
await pverb("behavior",{id:"meter",src:path,attach:METER.id,caps:{verbs:["say","place"]},knobs:{alone:600,tick:30}});
await settle(1500);
console.log("FOLD:",JSON.stringify(await eye()));
const ring=await req({type:"debug",behavior:"meter"},"r2"); console.log("ring:",JSON.stringify((ring.events||[]).slice(-3)));
console.log("errors:",errors.length?errors:"none"); process.exit(errors.length?3:0);
