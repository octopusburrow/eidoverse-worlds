// videopanel — the resident's graphics dials, in Settings where a visitor can
// find them. Every row here is LOCAL: a preference about this machine, never
// shared with the world (the build panel is for what the world looks like;
// this is for what your GPU can afford). The APIs already existed, scattered —
// render scale lived in the build panel, the rest were URL params or governor-
// only.
//
// Two rows apply on RELOAD, and say so: renderer backend and antialiasing are
// construction-time choices in three's WebGPURenderer (core.js), not live.
import { makeSection, flashHint } from './ui.js';
import { RENDER_SCALES, getRenderScale, setRenderScale,
  PARTICLE_TIERS, getParticleTier, setParticleTier,
  AVATAR_DETAILS, getAvatarDetail, setAvatarDetail } from './governor.js';
import { shadowsOn, setShadows } from './lightrig.js';
import { backendName, PREF_MSAA, PREF_BACKEND, PREF_HEADSET_SEEN, WEBGPU_XR, WEBGPU_POSSIBLE, XR_BOOT } from './core.js';
import { CONFIG, bus } from './base.js';
import { registerXRPanel } from './xrpanels.js';
import { WEBGL } from './capnotice.js';

// same markup contract as the audio section (label right of centre, control
// left of it — index.html owns .row.wide / .nm / .ctl)
function selectRow(label, hint, options, value, onChange) {
  const row = document.createElement('div');
  row.className = 'row wide';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', `${label} — local only, never shared with the world`);
  for (const [v, text] of options) sel.appendChild(new Option(text, v));
  sel.value = value;
  sel.onchange = () => onChange(sel.value, row);
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = hint;
  const ctl = document.createElement('span'); ctl.className = 'ctl'; ctl.appendChild(sel);
  row.append(nm, ctl);
  return row;
}
function checkRow(label, hint, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'row wide';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = label; nm.title = hint;
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked; cb.title = hint;
  cb.onchange = () => onChange(cb.checked, row);
  const ctl = document.createElement('span'); ctl.className = 'ctl'; ctl.appendChild(cb);
  row.append(nm, ctl);
  return row;
}
// a control that only applies next load grows a house button to do it now
function needsReload(row) {
  if (row.querySelector('.reload')) return;
  const b = document.createElement('button');
  b.className = 'reload'; b.textContent = 'reload';
  b.title = 'this setting applies when the renderer is built — reload now to apply it';
  b.style.padding = '2px 7px';
  b.onclick = () => location.reload();
  const ctl = row.querySelector('.ctl');
  ctl.style.flexWrap = 'wrap';   // the frame is narrow; the button drops under a wide select rather than off the edge
  ctl.appendChild(b);
}
const pct = (v) => v === 'auto' ? 'auto (adaptive)' : `${Math.round(v * 100)}%`;

// The same dials as a VR quad, under the rail's 'settings' id: the SAME
// getters and setters the desk's rows call (the who pattern — one source, one
// action set, two renderers); the desk's own rows are untouched. Discrete
// choices are list rows with a 'use' action because 'auto' appears in all
// three lists and a bare row click could not say which one it meant.
function videoFields() {
  const pick = (k, values, cur, label) => ({ t: 'list', label,
    rows: values.map((v) => ({ id: String(v), label: String(v), active: String(v) === String(cur),
      actions: String(v) === String(cur) ? [] : [{ k, label: 'use' }] })) });
  const msaaOn = (CONFIG.params.get('msaa') ?? localStorage.getItem(PREF_MSAA)) !== '0';
  return [
    pick('scale', RENDER_SCALES, getRenderScale(), 'render scale'),
    { t: 'check', k: 'shadows', label: 'shadows', value: shadowsOn() },
    pick('particles', PARTICLE_TIERS, getParticleTier(), 'particles'),
    pick('detail', Object.keys(AVATAR_DETAILS), getAvatarDetail(), 'avatar detail'),
    { t: 'check', k: 'msaa', label: 'antialiasing (on reload)', value: msaaOn },
  ];
}
function videoDispatch(k, v) {
  if (k === 'scale') setRenderScale(v);
  else if (k === 'shadows') setShadows(!!v);
  else if (k === 'particles') setParticleTier(v);
  else if (k === 'detail') setAvatarDetail(v);
  else if (k === 'msaa') localStorage.setItem(PREF_MSAA, v ? '1' : '0');
  else return;
  bus.emit('xr:repaint');
}

export function initVideoPanel() {
  registerXRPanel({ id: 'settings', title: 'settings · video', fields: videoFields, dispatch: videoDispatch });
  makeSection('🖥 video', (body) => {
    if (body.dataset.init) return;
    body.dataset.init = '1';

    // renderer: ONE control (R 09-07). auto matches the backend to what VR will use so entry never reloads;
    // force WebGPU / force WebGL are the overrides. A headset present + WebGPU-XR flags absent is the case that
    // makes force-WebGPU cost a reload-into-VR, so that combination is warned; force-WebGPU is disabled outright
    // when the machine has no WebGPU at all.
    const backend = backendName();
    const forced = CONFIG.params.has('webgl') || CONFIG.params.has('webgpu');
    const rpref = localStorage.getItem(PREF_BACKEND) || 'auto';
    const headsetSeen = localStorage.getItem(PREF_HEADSET_SEEN) === '1';
    const autoTail = headsetSeen
      ? (WEBGPU_XR ? 'A headset is present and this browser can present VR from WebGPU, so auto uses WebGPU — VR enters with no reload.'
                   : 'A headset is present but this browser has no WebGPU-to-VR binding, so auto uses WebGL — VR enters with no reload.')
      : (WEBGPU_POSSIBLE ? 'No headset sensed; auto uses WebGPU (the full renderer).' : 'No headset sensed and no WebGPU here; auto uses WebGL.');
    const why = forced ? `Set by a URL param for this session, overriding the choice below.`
      : `Running on ${backend === 'webgl' ? 'WebGL 2' : 'WebGPU'}. `;
    const rrow = selectRow('renderer',
      `How the world is drawn, and how VR gets in. auto: ${autoTail} — the no-lag default. `
      + `force WebGPU: always the full WebGPU renderer${WEBGPU_POSSIBLE ? '' : ' (unavailable on this machine)'}; if a headset is present but WebGPU-XR flags are off, entering VR reloads to WebGL first (a lag). `
      + `force WebGL: always WebGL 2 — guaranteed, for A/B testing or a machine where WebGPU misbehaves. Applies on reload.`,
      [['auto', 'auto'], ['webgpu', 'force WebGPU'], ['webgl', 'force WebGL']],
      rpref,
      (val, row) => {
        if (val === 'auto') localStorage.removeItem(PREF_BACKEND); else localStorage.setItem(PREF_BACKEND, val);
        needsReload(row);
        const w = row.querySelector('.rwarn'); if (w) w.remove();
        if (val === 'webgpu' && headsetSeen && !WEBGPU_XR) {
          const warn = document.createElement('div'); warn.className = 'note rwarn';
          warn.style.cssText = 'margin-top:4px;opacity:.85';
          warn.textContent = '⚠ A headset is present but WebGPU-XR flags aren’t enabled here — entering VR will reload the page onto WebGL, adding a few seconds. Use auto or force WebGL to avoid it.';
          row.appendChild(warn);
        }
      });
    // gray out force-WebGPU when the machine has no WebGPU at all
    if (!WEBGPU_POSSIBLE) { const o = rrow.querySelector('select option[value=webgpu]'); if (o) { o.disabled = true; o.text = 'force WebGPU (unavailable)'; } }
    body.appendChild(rrow);

    body.appendChild(selectRow('render scale',
      'Resolution the world is drawn at, as a share of your screen. The single biggest lever on a pixel-bound machine. auto lets the engine step it down when the frame rate sags and back up when it recovers; a pinned value is yours and the engine leaves it alone.',
      RENDER_SCALES.map((v) => [v, pct(v)]), getRenderScale(),
      (v) => { setRenderScale(v); flashHint(`render scale: ${pct(v)} (yours only)`); }));

    body.appendChild(checkRow('shadows',
      'The sun’s cast shadows. Off is the cheapest single change on a weak GPU; flipping it may recompile materials once.',
      shadowsOn(), (on) => { setShadows(on); flashHint(`shadows ${on ? 'on' : 'off'} (yours only)`); }));

    body.appendChild(selectRow('particles',
      'How many sprites particle effects draw. auto lets the engine thin them under load and restore them after.',
      PARTICLE_TIERS.map((v) => [v, v]), getParticleTier(),
      (v) => { setParticleTier(v); flashHint(`particles: ${v} (yours only)`); }));

    body.appendChild(selectRow('avatar detail',
      'How often other people’s bodies update as they get farther away. Lower spends less on a crowded world.',
      Object.keys(AVATAR_DETAILS).map((v) => [v, v]), getAvatarDetail(),
      (v) => { setAvatarDetail(v); flashHint(`avatar detail: ${v} (yours only)`); }));

    const msaaOn = (CONFIG.params.get('msaa') ?? localStorage.getItem(PREF_MSAA)) !== '0';
    body.appendChild(checkRow('antialiasing',
      '4× MSAA smooths edges; off measured about +10 fps on a 2× screen (core.js §22n). Set when the renderer is built, so it applies on reload.',
      msaaOn, (on, row) => { localStorage.setItem(PREF_MSAA, on ? '1' : '0'); needsReload(row); }));
  }, { id: 'video', host: 'settings' });
}
