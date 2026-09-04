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
import { backendName, PREF_MSAA, PREF_BACKEND, CONFIG } from './core.js';
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

export function initVideoPanel() {
  makeSection('🖥 video', (body) => {
    if (body.dataset.init) return;
    body.dataset.init = '1';

    // renderer: what you are on, why, and what would be faster
    const backend = backendName();
    const forced = CONFIG.params.has('webgl');   // a URL param outranks the choice below, this session
    const pref = localStorage.getItem(PREF_BACKEND) || 'auto';
    const why = forced ? `Set by ?webgl=${CONFIG.params.get('webgl')} for this session, overriding the choice below.`
      : backend === 'webgl' ? (pref === 'webgl' ? 'Chosen below.' : WEBGL.body)
      : 'WebGPU is available and in use — the full version of the renderer.';
    body.appendChild(selectRow('renderer',
      `Running on ${backend === 'webgl' ? 'WebGL 2' : 'WebGPU'}. ${why} Applies on reload.`,
      [['auto', 'auto'], ['webgl', 'WebGL 2']],
      pref,
      (v, row) => { if (v === 'auto') localStorage.removeItem(PREF_BACKEND); else localStorage.setItem(PREF_BACKEND, v); needsReload(row); }));

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
