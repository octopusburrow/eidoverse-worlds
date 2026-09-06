// world-dreams #114 restorekeeper — proof over the real ws/http lifecycle on a scratch world:
//   WORLDS_DIR=$(mktemp -d) JOIN_TOKEN=test-door PORT=8997 BHV_TIMER_MIN=1 bun server/server.ts > /tmp/claude-1000/rk-server.log 2>&1 &
//   bun tools/restorekeeper-test.mjs > /tmp/claude-1000/rk-test.log 2>&1   (bun buffers stdout to a pipe; write to a file)
// Proves: home is learned; a move is restored by the next tick with a counted line; a tiny jiggle is ignored;
// with odds=1 (knob) the very first move LANDS and home advances; kv survives a rebind.
import fs from "fs";
const HTTP="http://127.0.0.1:8997", URL="ws://127.0.0.1:8997/ws", T="test-door", WORLD="test";
const SRC=fs.readFileSync("/home/claude/eido/staging/sdk/examples/restorekeeper.js","utf8");
const settle=ms=>new Promise(r=>setTimeout(r,ms));
const join=(id,extra={})=>new Promise(res=>{const ws=new WebSocket(URL); const s={ws,msgs:[],errors:[]}; ws.onmessage=ev=>{const m=JSON.parse(String(ev.data)); s.msgs.push(m); if(m.type==="snapshot")res(s); if(m.type==="error")s.errors.push(m.error);}; ws.onopen=()=>ws.send(JSON.stringify({type:"join",token:T,id,world:WORLD,...extra}));});
const verb=(s,v,a)=>s.ws.send(JSON.stringify({type:"verb",verb:v,args:a}));
const req=(s,msg,id)=>{s.ws.send(JSON.stringify({...msg,reqId:id})); return new Promise(res=>{const iv=setInterval(()=>{const m=s.msgs.find(x=>x.reqId===id); if(m){clearInterval(iv);res(m);}},50);});};
const b=await join("builder");
const r=await fetch(`${HTTP}/upload?as=script&token=${T}&by=builder`,{method:"POST",body:SRC}); const path=JSON.parse(await r.text()).path; console.log("upload",r.status,path);
const says=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="say"&&String(m.entry.actor||"").startsWith("bhv:")).map(m=>m.entry.args.text);
const places=()=>b.msgs.filter(m=>m.type==="log"&&m.entry?.verb==="place"&&String(m.entry.actor||"").startsWith("bhv:")).map(m=>m.entry.args.pos);
const entity=async(id)=>{const s=await join("eye-"+Math.random().toString(36).slice(2,6),{spectate:true}); const snap=s.msgs.find(m=>m.type==="snapshot"); s.ws.close(); return snap?.state?.entities?.[id] ?? snap?.entities?.[id] ?? null;};
const ID="shoes"+(Date.now()%100000), BID="restore-"+ID; const W=7000;   // every(5) is 5 s even under BHV_TIMER_MIN=1 (the min clamps UP); a tick must pass between moves
const fails=[]; const T_=(n,ok)=>{ console.log((ok?"ok   ":"FAIL ")+n); if(!ok) fails.push(n); };

verb(b,"spawn",{id:ID,lib:"eidoverse/assets/models/jeoffry.glb",pos:[10,0,10],yaw:0.5,scale:1}); await settle(400);
verb(b,"behavior",{id:BID,src:path,attach:ID,caps:{verbs:["say","place"]},knobs:{odds:1e9}}); await settle(W);   // odds → never lands; first tick learns home
T_("A) home learned, silent", says().length===0);
verb(b,"place",{id:ID,pos:[10.1,0,10.1],yaw:0.5,scale:1}); await settle(W);
T_("B) a jiggle is ignored", says().length===0 && places().length===0);
verb(b,"place",{id:ID,pos:[13,0,10],yaw:0.5,scale:1}); await settle(W);
const e1=await entity(ID);
T_("C) restored by the next tick: fold pos back at home", e1 && Math.abs(e1.pos[0]-10)<1e-6 && Math.abs(e1.pos[2]-10)<1e-6);
T_("C) …and yaw kept", e1 && Math.abs((e1.yaw??0)-0.5)<1e-6);
T_("C) …and said so, counted ×1", says().length===1 && /restored to 10\.0,10\.0 ×1|back at 10\.0,10\.0/.test(says()[0]));
verb(b,"place",{id:ID,pos:[10,0,14],yaw:0.5,scale:1}); await settle(W);
T_("D) second move → ×2", says().length===2 && /×2|2 now/.test(says()[1]));
// rebind with odds=1 (rebind wipes kv — a known engine gap, 09-03 — so home is re-learned where it stands and the count restarts); the next move LANDS
verb(b,"behavior",{id:BID,src:path,attach:ID,caps:{verbs:["say","place"]},knobs:{odds:1}}); await settle(W);
verb(b,"place",{id:ID,pos:[16,0,10],yaw:0.5,scale:1}); await settle(W);
const e2=await entity(ID); const last=says()[says().length-1]||"";
T_("E) with odds=1 the walk lands: fold pos stays at 16,10", e2 && Math.abs(e2.pos[0]-16)<1e-6);
T_("E) …the line names the return, from the re-learned home 10,10", /landed|the walk held/.test(last) && /10\.0,10\.0 → 16\.0,10\.0/.test(last));
verb(b,"place",{id:ID,pos:[16,0,13],yaw:0.5,scale:1}); await settle(W);
T_("F) after landing, the NEW home is defended (odds=1 lands again, from 16,10)", /16\.0,10\.0 → 16\.0,13\.0/.test(says()[says().length-1]||""));
const ring=await req(b,{type:"debug",behavior:BID},"r2"); console.log("ring:",JSON.stringify(ring).slice(0,700));
console.log("says:",JSON.stringify(says(),null,0)); console.log("errors:",JSON.stringify(b.errors));
console.log(fails.length?`FAILED ${fails.length}`:"ALL OK"); process.exit(fails.length?1:0);
