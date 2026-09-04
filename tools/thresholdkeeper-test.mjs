// #113 thresholdkeeper — proof over the real ws/http lifecycle on a scratch world:
//   WORLDS_DIR=$(mktemp -d) JOIN_TOKEN=test-door PORT=8996 BHV_TIMER_MIN=1 bun server/server.ts &
//   bun tools/thresholdkeeper-test.mjs
// Proves: brush-past (< STAY_S) → silence; real visit + leave → exactly ONE send-off carrying the last words said inside; no repeat.
import fs from "fs";
const HTTP="http://127.0.0.1:8996", URL="ws://127.0.0.1:8996/ws", T="test-door", WORLD="test";
const SRC=fs.readFileSync("/home/claude/eido/staging/sdk/examples/thresholdkeeper.js","utf8");
const settle=ms=>new Promise(r=>setTimeout(r,ms));
const join=(id,extra={})=>new Promise(res=>{const ws=new WebSocket(URL); const s={ws,msgs:[],errors:[]}; ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); s.msgs.push(m); if(m.type==="snapshot")res(s); if(m.type==="error")s.errors.push(m.error);}; ws.onopen=()=>ws.send(JSON.stringify({type:"join",token:T,id,world:WORLD,...extra}));});
const verb=(s,v,a)=>s.ws.send(JSON.stringify({type:"verb",verb:v,args:a})); const pose=(s,p)=>s.ws.send(JSON.stringify({type:"pose",pose:{p,yaw:0,speed:0,clip:"idle",pitch:0}}));
const b=await join("builder"); const req=(s,msg,id)=>{s.ws.send(JSON.stringify({...msg,reqId:id})); return new Promise(res=>{const iv=setInterval(()=>{const m=s.msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});}; pose(b,[0,0,0]); await settle(300);
const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=builder`,{method:"POST",body:SRC}); const path=JSON.parse(await r.text()).path; console.log("upload",r.status,path);
verb(b,"spawn",{id:"gate1",lib:"eidoverse/assets/models/jeoffry.glb",pos:[10,0,10],yaw:0,scale:1}); await settle(500);
verb(b,"behavior",{id:"threshold-gate",src:path,attach:"gate1",caps:{verbs:["say"]}}); await settle(2500);
console.log("roster:",JSON.stringify((await req(b,{type:"debug",behaviors:true},"r1")).behaviors||(await req(b,{type:"debug",behaviors:true},"r1"))).slice(0,300)); const w=await join("walker"); pose(w,[40,0,40]); await settle(1500);           // far: not inside
pose(w,[12,0,12]); await settle(1500); verb(w,"say",{text:"are you cold?"}); await settle(2000);
pose(w,[26,0,26]); await settle(3000);                                          // left too soon (<STAY_S): must be silent
const says=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="say"&&String(m.entry.actor||"").startsWith("bhv:")).map(m=>m.entry.args.text);
console.log("A) brush-past → bhv says:",JSON.stringify(says()));
pose(w,[12,0,12]); await settle(1500); verb(w,"say",{text:"I set foot here"}); await settle(20000);  // stay ≥ STAY_S at tick granularity
pose(w,[30,0,30]); await settle(4000);
console.log("B) real visit + leave → bhv says:",JSON.stringify(says()));
await settle(4000); const ring=await req(b,{type:"debug",behavior:"threshold-gate"},"r2"); console.log("ring:",JSON.stringify(ring).slice(0,900)); console.log("C) no repeat → count:",says().length,"| errors:",JSON.stringify([...b.errors,...w.errors]));
process.exit(0);
