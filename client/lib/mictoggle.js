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

import { toggleMic, micOn } from './voice.js';
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

let micBtn = null;

function paint() {
  if (!micBtn) return;
  micBtn.innerHTML = MIC_SVG(micOn());
  micBtn.title = micOn() ? 'mic LIVE — the world hears you (V)' : 'mic off (V to talk)';
}

async function flipMic() {
  const on = await toggleMic(CONFIG.name);
  if (sttAvailable()) setSTT(on);
  paint();
}

function ensure() {
  const hud = document.querySelector('#hud');
  if (!hud || document.contains(micBtn)) return;
  // IN LINE with the bar (R, 15:47): a bare glyph riding at the end of the
  // hud's own row — no box, no chrome, just the mic. The hud repaints via
  // setHud(innerHTML) which would erase a child, so we sit AFTER the hud text
  // as a sibling-styled inline element inside the same visual bar.
  micBtn = document.createElement('span');
  micBtn.id = 'mictoggle';
  micBtn.style.cssText = 'cursor:pointer;vertical-align:middle;margin-left:8px;'
    + 'display:inline-block;line-height:0;';
  micBtn.onclick = flipMic;
  hud.after(micBtn);
  const r = hud.getBoundingClientRect();
  micBtn.style.cssText += `position:fixed;left:${Math.round(r.right + 8)}px;top:${Math.round(r.top + (r.height - 26) / 2)}px;z-index:45;`;
  paint();
}
setInterval(ensure, 1000);
ensure();

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyV' && !e.repeat
      && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) flipMic();
});
