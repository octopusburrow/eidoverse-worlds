// bun tools/glbperf-parity-probe.mjs — the library card's rank (server/glbperf.ts, read from the GLB) equals the
// loupe's (client perfscope.statsOf on the model the CLIENT's own loader builds from the same bytes). Ten library
// originals chosen for spread: the Commons palm (alpha), the excavator (tris), a crate (textures), and sizes across the
// range. Per model: tris, draws, mats, alpha, bones exact; texMB within 1%; rank and worst category equal.
import { launchBrowser, ownedWorld, checker } from './probe-harness.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { glbPerf } from '../server/glbperf.ts';

const { check, done } = checker();
const LIB = process.env.LIB || '/home/claude/eido/eidoverse-video/eidoverse/assets/models';
const all = readdirSync(LIB).filter((f) => f.endsWith('.glb')).sort((a, b) => statSync(`${LIB}/${a}`).size - statSync(`${LIB}/${b}`).size);
const pick = new Set([
  ...all.filter((f) => /palm_date|bagger_288|crate_large_blue/.test(f)),
  ...[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((q) => all[Math.floor(q * (all.length - 1))]),
]);
const OPTM = process.env.OPTM || '/home/claude/eido/staging/assets/opt/eidoverse/assets/models';
const models = [...pick].slice(0, 10).flatMap((m) => [{ dir: LIB, name: m }, ...(process.env.KTX2 !== '0' ? [{ dir: OPTM, name: `${m}.ktx2.glb` }] : [])])
  .filter(({ dir, name }) => { try { statSync(`${dir}/${name}`); return true; } catch { return false; } });

const world = await ownedWorld({});
const { browser, page } = await launchBrowser();
try {
  const pg = await page();
  const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
  await pg.route('**/__parity/**', (route) => {
    const key = decodeURIComponent(route.request().url().split('/__parity/')[1]);
    const [d, name] = key.split('|');
    route.fulfill({ body: readFileSync(`${d}/${name}`), headers: { 'content-type': 'model/gltf-binary' } });
  });
  await pg.goto(`${world.origin}/?world=staging&name=parityprobe&key=${world.key}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => globalThis.__ewEngineUp, null, { timeout: 60000 });
  for (const { dir, name: m } of models) {
    const server = glbPerf(new Uint8Array(readFileSync(`${dir}/${m}`)));
    const client = await Promise.race([pg.evaluate(async (name) => {
      const { makeLoader } = await import('./lib/assets.js');
      const { statsOf } = await import('./lib/perfscope.js');
      const gltf = await makeLoader().loadAsync(`/__parity/${encodeURIComponent(name)}`);
      window.__ktxFormats = window.__ktxFormats || new Set();
      gltf.scene.traverse((o) => { for (const mt of [].concat(o.material ?? [])) for (const v of Object.values(mt ?? {})) if (v?.isCompressedTexture) window.__ktxFormats.add(v.format); });
      const s = statsOf(gltf.scene, name);
      gltf.scene.traverse((o) => { o.geometry?.dispose?.(); for (const mt of [].concat(o.material ?? [])) { for (const v of Object.values(mt)) v?.isTexture && v.dispose(); mt.dispose?.(); } });
      return s;
    }, `${dir}|${m}`), new Promise((_, rej) => setTimeout(() => rej(new Error('load pinned 90 s')), 90000))]);
    const same = ['tris', 'draws', 'mats', 'alpha', 'bones'].filter((k) => server[k] !== client[k]);
    const texOk = Math.abs(server.texMB - client.texMB) <= Math.max(0.05, client.texMB * 0.01);
    const ok = !same.length && texOk && server.rank === client.rank && server.worst === client.worst;
    check(`${m.slice(0, 44)}: server = loupe (${client.rankName}, worst ${client.worst})`, ok,
      `server ${JSON.stringify({ tris: server.tris, draws: server.draws, mats: server.mats, alpha: server.alpha, bones: server.bones, texMB: server.texMB, rank: server.rank, worst: server.worst })} loupe ${JSON.stringify({ tris: client.tris, draws: client.draws, mats: client.mats, alpha: client.alpha, bones: client.bones, texMB: client.texMB, rank: client.rank, worst: client.worst })}`);
  }
  check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await browser.close(); await world.close(); }
done();
