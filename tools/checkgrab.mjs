import { chromium } from 'playwright';
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();
await p.goto('http://127.0.0.1:8940/?world=workbench&name=grabcheck&key=workbench-2026',{waitUntil:'load'});
await p.waitForTimeout(15000);
const r=await p.evaluate(async()=>{
  const { comps, entities } = await import('/lib/world.js');
  const o=entities.get('vrgrab1');
  return { exists: !!o, pos: o?.position?.toArray?.().map(n=>+n.toFixed(2)), comps: comps.get('vrgrab1') ?? null };
});
console.log(JSON.stringify(r)); await b.close();
