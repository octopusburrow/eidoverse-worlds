// world-dreams #115 meterkeeper — proof over the real ws/http lifecycle on a scratch world:
//   WORLDS_DIR=$(mktemp -d) JOIN_TOKEN=test-door PORT=8998 BHV_TIMER_MIN=1 bun server/server.ts > /tmp/mk-server.log 2>&1 &
//   bun tools/meterkeeper-test.mjs > /tmp/mk-test.log 2>&1   (bun buffers stdout to a pipe; write to a file)
// Proves: an address near it turns it one hour and says nothing; an address from afar does nothing; use turns it too;
// twelve addresses wrap the yaw; alone (nobody within 30 m) past the knob it speaks ONCE; a return resets; a second solitude speaks again.
import fs from "fs";
const HTTP="http://127.0.0.1:8998", WS="ws://127.0.0.1:8998/ws", T="test-door", WORLD="test";
const SRC=fs.readFileSync(new URL("../sdk/examples/meterkeeper.js", import.meta.url),"utf8");
const settle=ms=>new Promise(r=>setTimeout(r,ms));
const join=(id,extra={})=>new Promise(res=>{const ws=new WebSocket(WS); const s={ws,msgs:[],errors:[]}; ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); s.msgs.push(m); if(m.type==="snapshot")res(s); if(m.type==="error")s.errors.push(m.error);}; ws.onopen=()=>ws.send(JSON.stringify({type:"join",token:T,id,world:WORLD,...extra}));});
const verb=(s,v,a)=>s.ws.send(JSON.stringify({type:"verb",verb:v,args:a}));
const pose=(s,p)=>s.ws.send(JSON.stringify({type:"pose",pose:{p,yaw:0,speed:0,clip:"idle",pitch:0}}));
const req=(s,msg,id)=>{s.ws.send(JSON.stringify({...msg,reqId:id})); return new Promise(res=>{const iv=setInterval(()=>{const m=s.msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});};
const b=await join("builder");                       // no pose: not "near" anything
const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=builder`,{method:"POST",body:SRC}); const path=JSON.parse(await r.text()).path; console.log("upload",r.status,path);
const says=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="say"&&m.entry.actor==="bhv:"+BID).map(m=>m.entry.args.text);
const places=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="place"&&m.entry.actor==="bhv:"+BID).map(m=>m.entry.args.yaw);
const entity=async(id)=>{const s=await join("eye-"+Math.random().toString(36).slice(2,6),{spectate:true}); const snap=s.msgs.find(m=>m.type==="snapshot"); s.ws.close(); return snap?.state?.entities?.[id] ?? snap?.entities?.[id] ?? null;};
const ID="meter"+(Date.now()%100000), BID="bhv-"+ID, TICK=5500; const H=Math.PI/6;
const fails=[]; const T_=(n,ok)=>{ console.log((ok?"ok   ":"FAIL ")+n); if(!ok) fails.push(n); };
const close=(x)=>Math.abs(x)<1e-6;

verb(b,"spawn",{id:ID,lib:"eidoverse/assets/models/jeoffry.glb",pos:[10,0,10],yaw:0,scale:1}); await settle(400);
verb(b,"behavior",{id:BID,src:path,attach:ID,caps:{verbs:["say","place"]},knobs:{alone:8,tick:5}}); await settle(TICK);
const v=await join("visitor"); pose(v,[12,0,10]); await settle(400);          // 2 m away: earshot
verb(v,"say",{text:"hello, meter"}); await settle(800);
let e=await entity(ID);
T_("A) an address near it turns one hour (yaw π/6), says nothing", e && close(e.yaw-H) && says().length===0 && places().length===1);
pose(v,[40,0,10]); await settle(400);                                        // 30 m: out of earshot, still "around"
verb(v,"say",{text:"MEEEETER"}); await settle(800);
e=await entity(ID);
T_("B) shouted from afar: nothing turns", e && close(e.yaw-H) && places().length===1);
pose(v,[12,0,10]); await settle(400);
verb(v,"use",{id:ID,action:"touch"}); await settle(800);
e=await entity(ID);
T_("C) use is an address too → 2 hours", e && close(e.yaw-2*H) && places().length===2);
for(let i=0;i<10;i++){ verb(v,"say",{text:"you "+i}); await settle(250); } await settle(800);
e=await entity(ID);
T_("D) twelve addresses = one revolution (yaw wraps to ~0), still silent", e && (close(e.yaw) || close(e.yaw-2*Math.PI)) && says().length===0);
pose(v,[80,0,80]); await settle(TICK*3);                                     // gone: nobody within 30 m for > alone=8 s (tick 5 s)
T_("E) alone past the knob: speaks once, as the clock, naming 12 hours", says().length===1 && /clock that exists and does not know itself\. 12 hours/.test(says()[0]));
await settle(TICK*2);
T_("F) …and only once per solitude", says().length===1);
pose(v,[12,0,10]); await settle(TICK); verb(v,"say",{text:"back"}); await settle(800);
pose(v,[80,0,80]); await settle(TICK*3);
T_("G) return (an address), leave again → speaks a second time, the second line, 13 hours", says().length===2 && /contemplates Us\. 13 hours/.test(says()[1]));
const ring=await req(b,{type:"debug",behavior:BID},"r2"); console.log("ring:",JSON.stringify(ring).slice(0,600));
console.log("says:",JSON.stringify(says())); console.log("errors:",JSON.stringify(b.errors), JSON.stringify(v.errors));
console.log(fails.length?`FAILED ${fails.length}`:"ALL OK"); process.exit(fails.length?1:0);
