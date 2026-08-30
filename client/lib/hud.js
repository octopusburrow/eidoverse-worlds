// hud — the one status line. R's spec (08-29): the bar minimum is WHO you are
// and WHERE you are. Everything else — fps, the others count — is an extra you
// pin in via the pill's right-click checkboxes, persisted per person. The
// others count, when shown, is the door to the detachable who-frame; the
// editing flag and basic-sky note stay unconditional (transient meaning, not
// furniture). Painted at 1Hz by the pulse system; fps comes from perf.js.

import { CONFIG } from './core.js';
import { setHud, toggleRoster } from './ui.js';
import { net } from './net.js';
import { remotes } from './remotes.js';
import { isEditing } from './build.js';
import { skyImpl } from './sky.js';
import { perf } from './perf.js';

const statusDot = {
  live: '<span class="ok">●</span>', connecting: '<span>○</span>',
  retrying: '<span class="bad">●</span>', rejected: '<span class="bad">✕</span>',
};

const HUD_LS = 'ew-hud-extras';
let extras = { fps: false, others: true };
try { extras = { ...extras, ...JSON.parse(localStorage.getItem(HUD_LS) || '{}') } } catch {}
const saveExtras = () => { try { localStorage.setItem(HUD_LS, JSON.stringify(extras)) } catch {} };

export function paintHud() {
  const n = remotes.size;
  setHud(
    `${statusDot[net.status] ?? ''} <b>${CONFIG.name}</b> @ ${CONFIG.world}<span style="opacity:.4"> · b7</span>` +
    (extras.fps ? `   ${perf.fps}fps` : '') +
    (extras.others
      ? `   <button class="hud-others" title="who's here (opens the list)">${n} other${n === 1 ? '' : 's'}</button>`
      : '') +
    (isEditing() ? '   <span class="edit">✎ editing</span>' : '') +
    (skyImpl() === 'skymesh' ? '   <span style="opacity:.6">basic sky</span>' : ''),
  );
}

// ---- pill extras popover (right-click the pill) ---------------------------
let pop = null;
function closePop() { pop?.remove(); pop = null; }
function openPop(x, y) {
  closePop();
  pop = document.createElement('div');
  pop.className = 'panel hud-pop';
  pop.innerHTML = ['fps', 'others']
    .map((k) => `<label><input type="checkbox" data-k="${k}" ${extras[k] ? 'checked' : ''}> ${k === 'fps' ? 'framerate' : 'people count'}</label>`)
    .join('');
  pop.style.left = `${x}px`; pop.style.top = `${y}px`;
  pop.onchange = (e) => {
    const k = e.target?.dataset?.k;
    if (!k) return;
    extras[k] = e.target.checked; saveExtras(); paintHud();
  };
  document.body.appendChild(pop);
  setTimeout(() => addEventListener('pointerdown', (e) => {
    if (!pop?.contains(e.target)) closePop();
  }, { once: true, capture: true }));
}
document.addEventListener('contextmenu', (e) => {
  const hud = document.getElementById('hud');
  if (hud && e.target instanceof Node && hud.contains(e.target)) {
    e.preventDefault();
    openPop(e.clientX + 4, e.clientY + 4);
  }
});
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLElement && e.target.classList.contains('hud-others')) toggleRoster();
});
