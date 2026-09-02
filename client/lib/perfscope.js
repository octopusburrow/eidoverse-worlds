// perfscope — viewer-local perf instrumentation: false-color cost modes over
// the viewport + a hover loupe of deep per-object stats + a heaviest table.
//
// Doctrine (Mica's spec, 2026-09-01, + the prior-art survey):
// · VIEWER-LOCAL. No world verb is ever sent; nothing here mutates the log.
// · MEASURED vs ESTIMATED stays explicit: renderer.info counts are measured;
//   memory/cost numbers are estimates and say so. No GPU timers in v0 —
//   WebGL timer queries are dead-by-default post-Spectre and WebGPU
//   timestamps are a later bonus, so pretending estimates are hardware
//   measurements would be the one dishonest pixel in a debug tool.
// · Fixed absolute thresholds (UE/VRChat convention), not percentiles — a
//   scene of all-cheap objects must not invent red, and numbers stay
//   comparable across worlds. Rank = worst category wins (VRChat).
// · Survives scene churn: stats rebuild on a timer while active; tints are
//   restored only if the mesh still wears OUR material (an avatar swap that
//   replaced materials mid-tint is left alone).
//
// Cost attribution is per SUBJECT, not per mesh: a subject is a world entity
// (nearest ancestor in `entities`), a person (remotes / the local body), or
// the residual 'world fabric' bucket (terrain, sky, grass). That's the
// granularity questions actually arrive at ("what is heavy?" — "the fountain",
// not "mesh #217").

import { THREE, scene, camera, renderer, canvas } from './core.js';
import { entities, entityMeta } from './world.js';
import { fsvg } from './icons.js';

// data colors, not chrome: a perceptual cheap→dear ramp shared by every mode
// (VRChat's five ranks). Deliberately literal — these mean the same thing in
// every world and every theme, like a heatmap's, so they do NOT follow the
// accent picker.
// perceptually-separated ramp (R, 09-02: old ramp blurred — green≈lime, and
// the top three were all one warm tone). Even hue walk + rising chroma:
// emerald → spring-green → amber → tangerine → hot-red. Each tier is its own
// hue AND its own lightness, so they separate at a glance and for CVD eyes.
export const TIERS = ['#2fd08a', '#9be04a', '#ffc23d', '#ff7a2f', '#f23b52'];
const TIER_NAMES = ['excellent', 'good', 'medium', 'poor', 'very poor'];

// per-subject thresholds: crossing [i] puts you in tier i+1
const T = {
  tris:  [5_000, 20_000, 60_000, 150_000],
  draws: [2, 5, 12, 25],
  texMB: [8, 24, 64, 128],
  bones: [75, 150, 256, 400],
  mats:  [2, 4, 8, 16],
  alpha: [1, 3, 6, 12],
};
const tierOf = (v, k) => T[k].reduce((t, th) => (v > th ? t + 1 : t), 0);

// categorical material cost (an honest proxy — real instruction counts are
// not observable from here): lit-ness ladder + transparency/transmission tax
function matCost(m) {
  let c = 0;
  const n = m.type || '';
  if (/Physical|Node.*physical/i.test(n)) c = 4;
  else if (/Standard/i.test(n)) c = 3;
  else if (/Phong|Matcap/i.test(n)) c = 2;
  else if (/Lambert|Toon/i.test(n)) c = 1;
  else if (/NodeMaterial/i.test(n)) c = 3;          // TSL: assume standard-ish
  if (m.transparent) c += 1;
  if (m.transmission > 0) c += 2;
  return Math.min(4, c);
}

const bppOf = (tex) => {
  const f = tex.format, t = tex.type;
  if (t === THREE.FloatType) return 16;
  if (t === THREE.HalfFloatType) return 8;
  return f === THREE.RedFormat ? 1 : f === THREE.RGFormat ? 2 : 4;
};

// estimated GPU bytes for one texture (×1.33 mips). Compressed textures sum
// their real mip payloads instead of pretending to be RGBA8.
function texBytes(tex) {
  const img = tex.image;
  if (!img) return 0;
  if (tex.isCompressedTexture && Array.isArray(tex.mipmaps) && tex.mipmaps.length) {
    return tex.mipmaps.reduce((s, m) => s + (m.data?.byteLength ?? 0), 0);
  }
  const w = img.width ?? img.videoWidth ?? 0, h = img.height ?? img.videoHeight ?? 0;
  // mip chain adds exactly 1/3 (geometric series 1+¼+1/16+… = 4/3) IF mips exist:
  // real uploaded mipmaps, or the auto-generate flag on a power-of-two-ish image.
  const hasMips = (Array.isArray(tex.mipmaps) && tex.mipmaps.length > 1) ||
                  (tex.generateMipmaps && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter);
  return Math.round(w * h * bppOf(tex) * (hasMips ? 4 / 3 : 1));
}

// ---- collection -------------------------------------------------------------

let subjects = new Map();   // key -> stat record
let meshOwner = new WeakMap(); // mesh -> subject key (for the loupe raycast)

function freshRec(key, kind, label) {
  return { key, kind, label, tris: 0, verts: 0, draws: 0, meshes: 0,
    bones: 0, morphs: 0, instances: 0, alpha: 0, attrBytes: 0,
    mats: new Set(), texs: new Set(), texBytes: 0, meshList: [],
    rank: 0, worst: '' };
}

function collect() {
  // reverse index: entity Object3D -> id  (entities maps id -> node)
  const nodeToId = new Map();
  for (const [id, node] of entities) nodeToId.set(node, id);

  subjects = new Map();
  meshOwner = new WeakMap();
  const worldRec = freshRec('~world', 'fabric', 'world fabric (terrain · sky · grass …)');

  scene.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (o.userData?.perfscopeIgnore) return;          // our own helpers etc.

    // walk up: entity? a named remote/local body? else the fabric bucket
    let rec = null;
    for (let p = o; p; p = p.parent) {
      const id = nodeToId.get(p);
      if (id !== undefined) {
        rec = subjects.get(`e:${id}`);
        if (!rec) {
          const meta = entityMeta.get(id);
          rec = freshRec(`e:${id}`, 'entity', id + (meta?.lib ? `  (${String(meta.lib).split('/').pop()})` : ''));
          subjects.set(rec.key, rec);
        }
        break;
      }
      if (p.userData?.perfscopeSubject) {              // bodies tag themselves (below)
        rec = subjects.get(`p:${p.userData.perfscopeSubject}`);
        if (!rec) { rec = freshRec(`p:${p.userData.perfscopeSubject}`, 'person', p.userData.perfscopeSubject); subjects.set(rec.key, rec); }
        break;
      }
      // avatar roots stamp themselves (avatar.js: userData.who on every body)
      if (p.userData?.isBody || p.userData?.who) {
        const who = p.userData.who ?? 'someone';
        rec = subjects.get(`p:${who}`);
        if (!rec) { rec = freshRec(`p:${who}`, 'person', who); subjects.set(rec.key, rec); }
        break;
      }
    }
    if (!rec) { rec = worldRec; if (!subjects.has(rec.key)) subjects.set(rec.key, rec); }

    const g = o.geometry;
    const inst = o.isInstancedMesh ? o.count : 1;
    const idx = g?.index ? g.index.count : (g?.attributes?.position?.count ?? 0);
    rec.tris += Math.round(idx / 3) * inst;
    rec.verts += (g?.attributes?.position?.count ?? 0) * inst;
    rec.meshes += 1;
    rec.instances += inst > 1 ? inst : 0;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    rec.draws += Math.max(1, g?.groups?.length || mats.length);
    for (const m of mats) {
      if (!m) continue;
      rec.mats.add(m);
      if (m.transparent) rec.alpha += 1;
      // exhaustive texture sweep: any own value that IS a texture, plus
      // shader-style uniforms. Named-key lists missed everything MToon and
      // node materials carry (R's read, 09-01: unoptimized textures are the
      // real VRAM hit — so the census must not have blind spots).
      const seen = (t) => { if (t?.isTexture && !rec.texs.has(t)) { rec.texs.add(t); rec.texBytes += texBytes(t); } };
      for (const v of Object.values(m)) seen(v);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) seen(u?.value);
    }
    if (g?.attributes) for (const a of Object.values(g.attributes)) rec.attrBytes += a.array?.byteLength ?? 0;
    if (o.isSkinnedMesh && o.skeleton) rec.bones = Math.max(rec.bones, o.skeleton.bones.length);
    if (g?.morphAttributes?.position) rec.morphs = Math.max(rec.morphs, g.morphAttributes.position.length);
    rec.meshList.push(o);
    meshOwner.set(o, rec.key);
  });

  for (const rec of subjects.values()) {
    const tiers = {
      tris: tierOf(rec.tris, 'tris'), draws: tierOf(rec.draws, 'draws'),
      texMB: tierOf(rec.texBytes / 1e6, 'texMB'), bones: tierOf(rec.bones, 'bones'),
      mats: tierOf(rec.mats.size, 'mats'), alpha: tierOf(rec.alpha, 'alpha'),
    };
    rec.tiers = tiers;
    rec.rank = Math.max(...Object.values(tiers));
    rec.worst = Object.keys(tiers).find((k) => tiers[k] === rec.rank);
    rec.matCost = Math.max(0, ...[...rec.mats].map(matCost));
  }
  return subjects;
}

// ---- false-color modes ------------------------------------------------------

export const MODES = {
  off:      { label: 'off', tier: null },
  rank:     { label: 'overall rank (worst wins)', tier: (r) => r.rank },
  tris:     { label: 'triangles', tier: (r) => r.tiers.tris },
  draws:    { label: 'draw calls', tier: (r) => r.tiers.draws },
  tex:      { label: 'texture memory (est)', tier: (r) => r.tiers.texMB },
  mat:      { label: 'material cost (proxy)', tier: (r) => r.matCost },
  bones:    { label: 'skinning / bones', tier: (r) => r.tiers.bones },
  alpha:    { label: 'transparency', tier: (r) => r.tiers.alpha },
};

let mode = 'off';
// Tint is an OVERLAY, not a replacement (R, 09-01 23:05): a translucent
// veil mesh sharing the original's geometry draws over it, so the object's
// own detail stays readable beneath the cost color — plus a bounds outline
// per subject in its tier color. This also retires the material-swap/restore
// hazard entirely: originals are never touched.
const tintMats = TIERS.map((c) => {
  const m = new THREE.MeshBasicMaterial({
    color: new THREE.Color(c), transparent: true, opacity: 0.5,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  m.name = `perfscope-tint-${c}`;
  return m;
});
const veils = new Set();      // overlay meshes we added
const outlines = new Set();   // per-subject Box3Helpers
let outlinesOn = false;       // bounds boxes are opt-in (R, 09-02: 'a bit much' on by default)
const _box = new THREE.Box3();

function veilFor(mesh, mat) {
  let ov = null;
  if (mesh.isSkinnedMesh) {
    ov = new THREE.SkinnedMesh(mesh.geometry, mat);
    ov.bindMode = mesh.bindMode;
    ov.bind(mesh.skeleton, mesh.bindMatrix);
    ov.frustumCulled = false;
  } else if (mesh.isInstancedMesh) {
    ov = new THREE.InstancedMesh(mesh.geometry, mat, mesh.count);
    ov.instanceMatrix = mesh.instanceMatrix;
  } else {
    ov = new THREE.Mesh(mesh.geometry, mat);
  }
  ov.userData.perfscopeIgnore = true;
  ov.renderOrder = (mesh.renderOrder || 0) + 1;
  ov.raycast = () => {};          // the loupe must hit the REAL mesh beneath
  mesh.add(ov);                   // rides the original's transform verbatim
  return ov;
}

function applyTint() {
  clearTint();
  for (const rec of subjects.values()) {
    const t = Math.min(4, MODES[mode].tier?.(rec) ?? 0);
    _box.makeEmpty();
    for (const mesh of rec.meshList) {
      if (!mesh.parent) continue;                    // churned out since collect
      veils.add(veilFor(mesh, tintMats[t]));
      _box.expandByObject(mesh);
    }
    if (outlinesOn && !_box.isEmpty()) {
      const o = new THREE.Box3Helper(_box.clone(), new THREE.Color(TIERS[t]));
      o.userData.perfscopeIgnore = true;
      outlines.add(o);
      scene.add(o);
    }
  }
}

function clearTint() {
  for (const v of veils) v.parent?.remove(v);
  veils.clear();
  for (const o of outlines) { scene.remove(o); o.dispose?.(); }
  outlines.clear();
}

let timer = null;
export function setMode(next) {
  mode = next in MODES ? next : 'off';
  clearTimeout(timer); timer = null;
  if (mode === 'off') { clearTint(); onModeChange?.(); return; }
  const cycle = () => {
    collect(); applyTint(); paintTable();
    timer = setTimeout(cycle, 3000);      // churn survival: re-walk, re-paint
  };
  cycle();
  onModeChange?.();
}
export const activeMode = () => mode;
let onModeChange = null;

// ---- loupe ------------------------------------------------------------------

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let loupeEl = null, loupeOn = false, pinned = null, lastCast = 0;

const fmtB = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
// short tier words for the chunky row pills (R wants labeled pills back, 09-02)
const TIER_SHORT = ['great', 'good', 'ok', 'poor', 'bad'];
const badge = (t, txt, chunky) => `<b class="pf-badge${chunky ? ' pf-badge-lg' : ''}" style="background:${TIERS[Math.min(4, t)]}">${txt}</b>`;

function loupeHtml(rec) {
  // worst textures first, each with its estimated resident bytes; `raw`
  // flags an uncompressed image (the usual VRAM crime — a 4096² RGBA8
  // costs ~89 MB with mips where the same KTX2 costs ~11)
  // textures STACK vertically (R, 09-02), each on ONE line with its dims and
  // size TOGETHER (not split across the row). biggest first. `raw` = an
  // uncompressed image sitting in VRAM at full w·h·4 bytes — the usual VRAM
  // crime; a KTX2/compressed version of the same image costs ~4-8× less.
  const texRows = [...rec.texs]
    .map((t) => ({ t, b: texBytes(t) }))
    .sort((a, b) => b.b - a.b).slice(0, 4)
    .map(({ t, b }) => `<div class="pl-tex">${t.image?.width ?? '?'}×${t.image?.height ?? '?'}${t.isCompressedTexture ? '' : ' <em title="uncompressed — sits in VRAM at full size; a compressed (KTX2) version costs ~4-8× less">raw</em>'}<span class="pl-texb">${fmtB(b)}</span></div>`)
    .join('');
  const meta = rec.kind === 'entity' ? entityMeta.get(rec.key.slice(2)) : null;
  // Maya channel-box layout (R, 09-02): a 3-column grid with a center seam.
  // label RIGHT-justified against the seam · value RIGHT-justified against the
  // pill column (with buffer) · tier pill. Everything lines up on two clean
  // vertical rules instead of floating apart.
  const boundsTip = (label, key) => {
    const th = T[key]; if (!th) return '';
    const u = key === 'texMB' ? ' MB' : '';
    const parts = TIER_SHORT.map((name, i) =>
      i < th.length ? `${name} ≤${th[i].toLocaleString()}${u}` : `${name} >${th[th.length - 1].toLocaleString()}${u}`);
    return `${label} — ${parts.join(' · ')}`;
  };
  const row = (label, val, tier, key) =>
    `<div class="pll">${label}</div><div class="plv">${val}</div>${
      tier == null ? '<div></div>' : `<div class="plp" title="${esc(boundsTip(label, key))}">${badge(tier, TIER_SHORT[Math.min(4, tier)], true)}</div>`}`;
  const rows = [
    row('triangles', rec.tris.toLocaleString(), rec.tiers.tris, 'tris'),
    row('draw calls', rec.draws, rec.tiers.draws, 'draws'),
    row('materials', rec.mats.size, rec.tiers.mats, 'mats'),
    row('textures', rec.texs.size, null),
    texRows ? `<div class="pl-texwrap">${texRows}</div>` : '',
    row('tex VRAM', fmtB(rec.texBytes), rec.tiers.texMB, 'texMB'),
    row('geometry', fmtB(rec.attrBytes), null),
    rec.bones ? row('bones', rec.bones, rec.tiers.bones, 'bones') : '',
    rec.morphs ? row('morph targets', rec.morphs, null) : '',
    rec.instances ? row('instances', rec.instances.toLocaleString(), null) : '',
    rec.alpha ? row('transparent mats', rec.alpha, rec.tiers.alpha, 'alpha') : '',
    row('meshes', rec.meshes, null),
  ].join('');
  // "why this rank" — the overall badge carries a hover explaining the rule
  // (worst category wins, VRChat model) and which metric set THIS rank.
  const worstLabel = { tris: 'triangles', draws: 'draw calls', texMB: 'texture VRAM',
    bones: 'bones', mats: 'materials', alpha: 'transparency' }[rec.worst] || rec.worst;
  const why = `overall = worst category wins (VRChat model). this object's ${TIER_NAMES[rec.rank]} rank is set by ${worstLabel}. fix the red/orange rows to raise it.`;
  // header: the rank pill, then a right column with the name and (aligned
  // under it, R 09-02) the 'placed by' line — so the sub-text lines up with
  // the name, not the pill.
  return `
  <div class="pl-head"><span title="${esc(why)}" class="pl-rank">${badge(rec.rank, TIER_NAMES[rec.rank], true)}</span><div class="pl-headtext"><b>${rec.label}</b>${meta?.by ? `<div class="pl-sub">placed by ${meta.by}</div>` : ''}</div></div>
  <div class="pl-grid">${rows}</div>
  <div class="pl-foot">${pinned ? 'click elsewhere to unpin' : 'click to pin'}</div>`;
}

function castAt(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(scene.children, true);
  for (const h of hits) {
    let key = null;
    for (let p = h.object; p && !key; p = p.parent) key = meshOwner.get(p) ?? null;
    if (key) return subjects.get(key);
  }
  return null;
}

function onMove(ev) {
  if (!loupeOn || pinned) return;
  const now = performance.now();
  if (now - lastCast < 90) return;
  lastCast = now;
  if (!subjects.size) collect();
  const rec = castAt(ev);
  if (!rec) { loupeEl.classList.remove('show'); return; }
  loupeEl.innerHTML = loupeHtml(rec);
  placeLoupe(ev);
  loupeEl.classList.add('show');
}

function placeLoupe(ev) {
  const w = loupeEl.offsetWidth, h = loupeEl.offsetHeight;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 16;
  if (y + h > innerHeight - 8) y = innerHeight - h - 8;
  loupeEl.style.left = `${Math.max(4, x)}px`;
  loupeEl.style.top = `${Math.max(4, y)}px`;
}

function onClick(ev) {
  if (!loupeOn) return;
  if (pinned) { pinned = null; loupeEl.classList.remove('show'); return; }
  const rec = castAt(ev);
  if (rec) { pinned = rec; loupeEl.innerHTML = loupeHtml(rec); placeLoupe(ev); loupeEl.classList.add('show'); }
}

export function setLoupe(onOff) {
  loupeOn = !!onOff;
  pinned = null;
  if (!loupeEl) {
    loupeEl = document.createElement('div');
    loupeEl.className = 'perf-loupe';
    document.body.appendChild(loupeEl);
  }
  document.body.classList.toggle('loupe-on', loupeOn);  // the loupe cursor (ui.js bakes it)
  if (loupeOn) {
    if (!subjects.size) collect();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('click', onClick);
  } else {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('click', onClick);
    loupeEl.classList.remove('show');
  }
  onLoupeChange?.(loupeOn);
}
let onLoupeChange = null;

// ---- heaviest table + receipt ----------------------------------------------

let tableEl = null;

const metricOf = (r) => mode === 'tex' ? r.texBytes : mode === 'draws' ? r.draws
  : mode === 'bones' ? r.bones : mode === 'mat' ? r.matCost
  : mode === 'alpha' ? r.alpha : r.tris;
const metricFmt = (r) => mode === 'tex' ? fmtB(r.texBytes) : mode === 'draws' ? `${r.draws} dc`
  : mode === 'bones' ? `${r.bones} bones` : mode === 'alpha' ? `${r.alpha} α`
  : `${(r.tris / 1000).toFixed(r.tris > 9999 ? 0 : 1)}k tri`;

function paintTable() {
  if (!tableEl) return;
  const rows = [...subjects.values()]
    .sort((a, b) => (mode === 'rank' ? b.rank - a.rank || b.tris - a.tris : metricOf(b) - metricOf(a)))
    .slice(0, 6);
  tableEl.innerHTML = rows.map((r) =>
    `<div class="pf-row" data-key="${r.key}">
       <i style="background:${TIERS[MODES[mode].tier?.(r) ?? r.rank]}"></i>
       <span>${r.label}</span><em>${metricFmt(r)}</em>
     </div>`).join('') || '<div class="pf-row"><span>nothing collected yet</span></div>';
}

function flashSubject(key) {
  const rec = subjects.get(key);
  const target = rec?.meshList[0];
  if (!target) return;
  const box = new THREE.BoxHelper(rec.kind === 'entity' ? entities.get(key.slice(2)) ?? target : target, 0xffffff);
  box.userData.perfscopeIgnore = true;
  scene.add(box);
  setTimeout(() => { scene.remove(box); box.dispose?.(); }, 1800);
}

async function copyReceipt() {
  if (!subjects.size) collect();
  let gpu = 'unknown';
  try {
    const gl = renderer.getContext?.();
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    else if (renderer.backend?.adapter?.info) {
      const i = renderer.backend.adapter.info;
      gpu = `${i.vendor ?? ''} ${i.architecture ?? ''} ${i.device ?? ''}`.trim() || 'webgpu';
    }
  } catch { /* identity stays unknown; the receipt says so honestly */ }
  const info = renderer.info;
  const receipt = {
    kind: 'perfscope-receipt', v: 1, at: new Date().toISOString(),
    page: location.href.replace(/key=[^&]*/, 'key=…'),
    ua: navigator.userAgent, gpu,
    measured: { calls: info?.render?.calls, triangles: info?.render?.triangles,
      geometries: info?.memory?.geometries, textures: info?.memory?.textures },
    estimated: true, thresholds: T,
    subjects: [...subjects.values()]
      .sort((a, b) => b.rank - a.rank || b.tris - a.tris).slice(0, 20)
      .map((r) => ({ label: r.label, kind: r.kind, rank: TIER_NAMES[r.rank], worst: r.worst,
        tris: r.tris, draws: r.draws, mats: r.mats.size, texMB: +(r.texBytes / 1e6).toFixed(1),
        bones: r.bones, meshes: r.meshes, instances: r.instances,
        topTex: [...r.texs].map((t) => ({ b: texBytes(t), w: t.image?.width, h: t.image?.height, raw: !t.isCompressedTexture }))
          .sort((a, b) => b.b - a.b).slice(0, 3)
          .map((x) => `${x.w}x${x.h}${x.raw ? ' raw' : ''} ${(x.b / 1e6).toFixed(1)}MB`) })),
  };
  const text = JSON.stringify(receipt, null, 1);
  try { await navigator.clipboard.writeText(text); } catch { console.log(text); }
  return receipt.subjects.length;
}

// ---- panel section ----------------------------------------------------------

/** Mounts the perf section into the debug panel's stack. */
export function buildPerfPanel(stack, { toast = console.log } = {}) {
  const head = document.createElement('div');
  head.className = 'row';
  head.style.cssText = 'margin-top:6px;opacity:.75';
  head.textContent = '— perf (viewer-local) —';

  const modeRow = document.createElement('div');
  modeRow.className = 'row';
  const lbl = document.createElement('span');
  lbl.className = 'nm'; lbl.textContent = 'overlay';
  const sel = document.createElement('select');
  sel.style.cssText = 'flex:0 1 auto;max-width:150px;min-width:0;margin-left:auto';
  for (const [k, m] of Object.entries(MODES)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = m.label;
    sel.appendChild(o);
  }
  sel.onchange = () => setMode(sel.value);
  onModeChange = () => { sel.value = mode; };
  modeRow.append(lbl, sel);

  // the loupe gets a proper TOOL button (R, 09-01): key-mirror styling,
  // its own glyph, pressed-in while armed; the cursor changes with it
  const loupeRow = document.createElement('div');
  loupeRow.className = 'row';
  const lb = document.createElement('button');
  lb.className = 'keybtn pf-loupe-btn';
  lb.title = 'loupe — hover an object for its cost card; click pins';
  lb.innerHTML = `${fsvg('magnifying-glass', 15)}<span>loupe</span>`;
  lb.onclick = () => setLoupe(!loupeOn);
  onLoupeChange = (on) => lb.classList.toggle('on', on);
  loupeRow.append(lb);

  const olRow = document.createElement('label');
  olRow.className = 'row';
  olRow.style.cssText = 'gap:8px';
  const olCb = document.createElement('input');
  olCb.type = 'checkbox'; olCb.checked = outlinesOn;
  olCb.onchange = () => { outlinesOn = olCb.checked; if (mode !== 'off') applyTint(); };
  const olNm = document.createElement('span');
  olNm.className = 'nm'; olNm.textContent = 'bounds outlines';
  olRow.append(olCb, olNm);

  const legend = document.createElement('div');
  legend.className = 'pf-legend';
  legend.innerHTML = TIERS.map((c, i) => `<i style="background:${c}" title="${TIER_NAMES[i]}"></i>`).join('')
    + '<span>cheap → costly · fixed thresholds</span>';

  tableEl = document.createElement('div');
  tableEl.className = 'pf-table';
  tableEl.onclick = (e) => {
    const k = e.target.closest('.pf-row')?.dataset.key;
    if (k) flashSubject(k);
  };

  const btns = document.createElement('div');
  btns.className = 'row btn-row';
  const rescan = document.createElement('button');
  rescan.textContent = 'rescan';
  rescan.onclick = () => { collect(); if (mode !== 'off') applyTint(); paintTable(); toast('perfscope: rescanned'); };
  const rcpt = document.createElement('button');
  rcpt.textContent = 'copy receipt';
  rcpt.onclick = async () => toast(`perfscope: receipt copied (${await copyReceipt()} subjects)`);
  btns.append(rescan, rcpt);

  stack.append(head, modeRow, loupeRow, olRow, legend, tableEl, btns);
}

/** Full teardown — restore every material, drop listeners, stop timers. */
export function perfscopeOff() {
  setMode('off');
  setLoupe(false);
}
