// #113 thresholdkeeper — proof over the real ws/http lifecycle on a scratch world:
//   WORLDS_DIR=$(mktemp -d) JOIN_TOKEN=test-door PORT=8996 BHV_TIMER_MIN=1 bun server/server.ts &
//   bun tools/thresholdkeeper-test.mjs
// Proves: brush-past → silence; visit+say+leave → ONE send-off carrying the words; silent visit → the heart's newest kept name; no repeats.
import fs from "fs";
const HTTP="http://127.0.0.1:8996", WS="ws://127.0.0.1:8996/ws", T="test-door", WORLD="test";
const SRC=fs.readFileSync(new URL("../sdk/examples/thresholdkeeper.js", import.meta.url),"utf8");
const settle=ms=>new Promise(r=>setTimeout(r,ms));
const join=(id,extra={})=>new Promise(res=>{const ws=new WebSocket(WS); const s={ws,msgs:[],errors:[]}; ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); s.msgs.push(m); if(m.type==="snapshot")res(s); if(m.type==="error")s.errors.push(m.error);}; ws.onopen=()=>ws.send(JSON.stringify({type:"join",token:T,id,world:WORLD,...extra}));});
const verb=(s,v,a)=>s.ws.send(JSON.stringify({type:"verb",verb:v,args:a})); const pose=(s,p)=>s.ws.send(JSON.stringify({type:"pose",pose:{p,yaw:0,speed:0,clip:"idle",pitch:0}}));
const b=await join("builder"); const req=(s,msg,id)=>{s.ws.send(JSON.stringify({...msg,reqId:id})); return new Promise(res=>{const iv=setInterval(()=>{const m=s.msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});}; pose(b,[0,0,0]); await settle(300);
const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=builder`,{method:"POST",body:SRC}); const path=JSON.parse(await r.text()).path; console.log("upload",r.status,path);
verb(b,"spawn",{id:"gate1",lib:"eidoverse/assets/models/jeoffry.glb",pos:[10,0,10],yaw:0,scale:1}); await settle(500);
verb(b,"spawn",{id:"heart1",lib:"eidoverse/assets/models/jeoffry.glb",pos:[0,0,20],yaw:0,scale:1}); await settle(500); verb(b,"comp",{id:"heart1",type:"names",data:["the one who asked"]}); await settle(500);
verb(b,"spawn",{id:"meter1",lib:"eidoverse/assets/models/jeoffry.glb",pos:[0,0,30],yaw:0,scale:1}); await settle(500); verb(b,"comp",{id:"meter1",type:"hours",data:4}); await settle(500);   // a meter with 4 on its face (its keeper would write this)
verb(b,"behavior",{id:"threshold-gate",src:path,attach:"gate1",caps:{verbs:["say"]},knobs:{heart:"heart1",meter:"meter1"}}); await settle(2500);
console.log("roster:",JSON.stringify((await req(b,{type:"debug",behaviors:true},"r1")).behaviors||(await req(b,{type:"debug",behaviors:true},"r1"))).slice(0,300)); const w=await join("walker"); pose(w,[40,0,40]); await settle(1500);           // far: not inside
pose(w,[12,0,12]); await settle(1500); verb(w,"say",{text:"are you cold?"}); await settle(2000);
pose(w,[26,0,26]); await settle(3000);                                          // left too soon (<STAY_S): must be silent
const says=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="say"&&String(m.entry.actor||"").startsWith("bhv:")).map(m=>m.entry.args.text);
console.log("A) brush-past → bhv says:",JSON.stringify(says()));
pose(w,[12,0,12]); await settle(1500); verb(w,"say",{text:"I set foot here"}); await settle(20000);  // stay ≥ STAY_S at tick granularity
verb(b,"comp",{id:"meter1",type:"hours",data:7}); await settle(600);                                    // three addresses happened while they were inside
pose(w,[26,0,26]); await settle(800); verb(w,"say",{text:"this was said outside"}); await settle(800);     // 22 m out, before the tick notices the departure: must NOT be carried
pose(w,[30,0,30]); await settle(4000);
console.log("B) real visit + leave → bhv says:",JSON.stringify(says()));
console.log("B1) …carrying the INSIDE word, not the one said 22 m out:", /take "I set foot here"/.test(says().slice(-1)[0]||"") ? "ok" : "FAIL");
console.log("B2) …with the meter's hours:", /the meter has 7 on its face now; 3 of them were yours/.test(says().slice(-1)[0]||"") ? "ok" : "FAIL");
await settle(4000); pose(w,[12,0,12]); await settle(20000); pose(w,[30,0,30]); await settle(12000);
console.log("D) silent visit + heart → bhv says:",JSON.stringify(says().slice(-1)));
console.log("D2) …none of the hours were theirs:", /7 on its face; none of them were yours/.test(says().slice(-1)[0]||"") ? "ok" : "FAIL");
const ring=await req(b,{type:"debug",behavior:"threshold-gate"},"r2"); console.log("ring:",JSON.stringify(ring).slice(0,900)); console.log("C) no repeat → count:",says().length,"| errors:",JSON.stringify([...b.errors,...w.errors]));
process.exit(0);
