// mictoggle — the porch-old mic badge, reborn for eidoverse. (R, 15:42: voice
// controls out of the dock, one clean SVG toggle riding beside the top-left
// HUD pane, muted by default.)
//
// Ours, whole: self-injecting like the workshop button, deletable with this
// file. States, porch doctrine:
//   grey + slash  = mic off (the default — a body should wake up silent)
//   warm ring     = mic live, world can hear you
// A small headphone glyph beside it mutes INCOMING voice separately.
// V toggles the mic from the keyboard, exactly like the porch.

import { toggleMic, micOn, toggleMute, isMuted } from './voice.js';
import { setSTT, sttAvailable } from './stt.js';
import { CONFIG } from './core.js';

const MIC_SVG = (on) => `
<svg viewBox="0 0 32 32" width="26" height="26">
  <g fill="none" stroke="${on ? '#ffc46b' : '#7d8f8a'}" stroke-width="2" stroke-linecap="round">
    <rect x="12" y="5" width="8" height="14" rx="4" fill="${on ? 'rgba(255,196,107,.25)' : 'none'}"/>
    <path d="M8 15 a8 8 0 0 0 16 0"/>
    <line x1="16" y1="23" x2="16" y2="27"/>
    <line x1="11" y1="27" x2="21" y2="27"/>
    ${on ? '' : '<line x1="7" y1="4" x2="25" y2="28" stroke="#c0574f"/>'}
  </g>
  ${on ? '<circle cx="16" cy="13" r="13.5" fill="none" stroke="rgba(255,196,107,.5)" stroke-width="1.5"/>' : ''}
</svg>`;

const EAR_SVG = (muted) => `
<svg viewBox="0 0 32 32" width="20" height="20">
  <g fill="none" stroke="${muted ? '#c0574f' : '#7d8f8a'}" stroke-width="2" stroke-linecap="round">
    <path d="M6 13 a10 10 0 0 1 20 0 v6"/>
    <rect x="4" y="14" width="5" height="9" rx="2"/>
    <rect x="23" y="14" width="5" height="9" rx="2"/>
    ${muted ? '<line x1="6" y1="5" x2="26" y2="27"/>' : ''}
  </g>
</svg>`;

let micBtn = null, earBtn = null, wrap = null;

function paint() {
  if (!micBtn) return;
  micBtn.innerHTML = MIC_SVG(micOn());
  micBtn.title = micOn() ? 'mic LIVE — the world hears you (V)' : 'mic off (V to talk)';
  earBtn.innerHTML = EAR_SVG(isMuted());
  earBtn.title = isMuted() ? 'incoming voices muted' : 'mute incoming voices';
}

async function flipMic() {
  const on = await toggleMic(CONFIG.name);
  if (sttAvailable()) setSTT(on);
  paint();
}

function ensure() {
  const hud = document.querySelector('#hud');
  if (!hud || document.contains(wrap)) return;
  wrap = document.createElement('div');
  wrap.id = 'mictoggle';
  const r = hud.getBoundingClientRect();
  wrap.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 6)}px;`
    + 'z-index:45;display:flex;gap:6px;align-items:center;';
  const mk = (extra) => {
    const b = document.createElement('button');
    b.style.cssText = 'background:rgba(6,16,22,.62);border:1px solid var(--edge);'
      + 'border-radius:8px;padding:4px 6px;cursor:pointer;line-height:0;' + (extra || '');
    return b;
  };
  micBtn = mk();
  micBtn.onclick = flipMic;
  earBtn = mk('opacity:.8');
  earBtn.onclick = () => { toggleMute(); paint(); };
  wrap.append(micBtn, earBtn);
  document.body.appendChild(wrap);
  paint();
}
setInterval(ensure, 1000);
ensure();

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyV' && !e.repeat
      && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) flipMic();
});
