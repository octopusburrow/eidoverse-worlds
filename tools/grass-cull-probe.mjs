// bun tools/grass-cull-probe.mjs — is any grass frustum-culled while it is ON SCREEN? (R, 09-24: "grass popping in and
// out at some facing angles".) Renders one viewpoint with its own camera, sweeping yaw, each frame TWICE: flora's
// instanced tiles culled as shipped, then with frustumCulled=false. Every pixel that differs is grass the culler
// dropped while visible. Same scene, same frame, back to back — only the culling flag changes.
// Env: GC_WORLD (a worlds dir holding the world, copied — the probe owns its server), GC_NAME (world), GC_POS "x,z",
// GC_PITCH, GC_STEP (deg), GC_OUT (png of the worst yaw: shipped | unculled | diff×8).
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { writeFileSync } from 'node:fs';
const { check, done } = checker();
const [px, pz] = (process.env.GC_POS ?? '0,0').split(',').map(Number);
const world = await ownedWorld(process.env.GC_WORLD ? { env: { WORLDS_DIR: process.env.GC_WORLD } } : {});
const { browser, page } = await launchBrowser();
try {
  const pg = await page();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.goto(`${world.origin}/?world=${process.env.GC_NAME ?? 'staging'}&name=grasscull&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 120000 });
  // GC_GRASS='{…grass verb args…}': plant through the real verb first (a light world can carry any species)
  if (process.env.GC_GRASS) await pg.evaluate(async (a) => { const { sendVerb } = await import('./lib/net.js'); sendVerb('grass', JSON.parse(a)); }, process.env.GC_GRASS);
  await pg.waitForTimeout(15000);
  const r = await Promise.race([pg.evaluate(async ({ px, pz, pitch, step }) => {
    const { THREE, scene, renderer } = await import('./lib/core.js');
    const tiles = []; scene.traverse((o) => { if (o.isInstancedMesh && o.frustumCulled && o.boundingSphere && o.material?.positionNode) tiles.push(o); });
    const W = 480, H = 270;
    const cam = new THREE.PerspectiveCamera(70, W / H, 0.1, 2000);
    let groundY = 0;
    { const rc = new THREE.Raycaster(new THREE.Vector3(px, 500, pz), new THREE.Vector3(0, -1, 0)); rc.camera = cam; const hit = rc.intersectObjects(scene.children, true).find((h) => !h.object.isInstancedMesh && !h.object.isSprite); if (hit) groundY = hit.point.y; }
    const rt = new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, samples: 0 });
    const shot = async () => { renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null); return await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H); };
    const rows = []; let worst = null;
    for (let yawDeg = 0; yawDeg < 360; yawDeg += step) {
      const yaw = yawDeg * Math.PI / 180;
      cam.position.set(px, groundY + 1.6, pz); cam.rotation.set(pitch, yaw, 0, 'YXZ'); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const culled = tiles.filter((t) => t.visible && t.count > 0 && !fr.intersectsSphere(t.boundingSphere.clone().applyMatrix4(t.matrixWorld)));
      const a = await shot();
      for (const t of tiles) t.frustumCulled = false;
      const b = await shot();
      for (const t of tiles) t.frustumCulled = true;
      let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) diff++;
      rows.push({ yawDeg, culled: culled.length, diff });
      if (!worst || diff > worst.diff) {
        const img = new ImageData(W * 3, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, o = ((H - 1 - y) * W * 3 + x) * 4;
          for (let k = 0; k < 3; k++) { img.data[o + k] = a[i + k]; img.data[o + W * 4 + k] = b[i + k]; img.data[o + W * 8 + k] = Math.min(255, Math.abs(a[i + k] - b[i + k]) * 8); }
          img.data[o + 3] = img.data[o + W * 4 + 3] = img.data[o + W * 8 + 3] = 255; }
        const cv = document.createElement('canvas'); cv.width = W * 3; cv.height = H; cv.getContext('2d').putImageData(img, 0, 0);
        worst = { yawDeg, diff, png: cv.toDataURL() };
      }
    }
    return { tiles: tiles.length, groundY, rows, worst };
  }, { px, pz, pitch: Number(process.env.GC_PITCH ?? -0.23), step: Number(process.env.GC_STEP ?? 5) }), new Promise((_, rej) => setTimeout(() => rej(new Error('pinned 300 s')), 300000))]);
  const bad = r.rows.filter((x) => x.diff > 0);
  console.log(`   ${r.tiles} flora tiles, ground y ${r.groundY.toFixed(2)}; yaws with culled-but-visible grass: ${bad.length}/${r.rows.length}`);
  for (const x of bad.slice(0, 20)) console.log(`     yaw ${x.yawDeg}°: ${x.diff} px differ (${x.culled} tiles culled)`);
  if (process.env.GC_OUT && r.worst) writeFileSync(process.env.GC_OUT, Buffer.from(r.worst.png.split(',')[1], 'base64'));
  check('the viewpoint sees flora tiles (the measurement has a subject)', r.tiles > 0 && r.rows.some((x) => x.culled > 0), r.tiles);
  check('no yaw culls grass that is on screen', bad.length === 0, bad.slice(0, 5));
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
