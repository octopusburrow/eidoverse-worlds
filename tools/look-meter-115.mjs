import { chromium } from 'playwright';
const T = process.env.T || ''; const OUT = process.env.OUT || '/tmp/claude-1000/meter-look.png';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
await page.goto(`http://127.0.0.1:8960/?world=staging&name=look-115&key=${T}&spectate=1&webgl=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__ewEngineUp === true, { timeout: 90000 }); await page.waitForTimeout(25000);
const r = await page.evaluate(async () => {
  const { scene, camera } = globalThis.EW; let meter = null; scene.traverse(o => { if (!meter && /meter1/.test(o.name || '')) meter = o; });
  const shots = [];
  for (const [i, [cx, cz]] of [[53.5, 70], [60, 64]].entries()) {
    camera.position.set(cx, 1.6, cz); camera.lookAt(57, 0.7, 67); camera.updateMatrixWorld(true);
    await new Promise(r => setTimeout(r, 400));
    shots.push({ i, cam: [cx, 1.6, cz], camNow: camera.position.toArray().map(v => +v.toFixed(1)) });
  }
  return { found: !!meter, meterName: meter?.name, pos: meter ? meter.getWorldPosition(new (meter.position.constructor)()).toArray().map(v => +v.toFixed(2)) : null, shots };
});
console.log(JSON.stringify(r));
// second pass: place the camera and shoot within the same tick as a render
for (const [i, [cx, cz]] of [[53.5, 70], [60, 64]].entries()) {
  await page.evaluate(([cx, cz]) => { const { camera } = globalThis.EW; camera.position.set(cx, 1.6, cz); camera.lookAt(57, 0.7, 67); }, [cx, cz]);
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT.replace('.png', `-${i}.png`) });
}
console.log('errors:', JSON.stringify(errs)); await b.close();
