// profile — the PERSON noun's home (four-noun taxonomy, 08-29): who you are,
// where you are, what you're wearing, what you carry, who you know.
// DELIBERATELY A SKETCH (R, 22:01): real satchel/worlds/friends need server
// surfaces that don't exist yet; this stakes out the shape, VRChat-ish —
// a bigger panel, identity up top, destination tiles below.

import { CONFIG, bus, colorFor } from './core.js';
import { makeFrame } from './frames.js';
import { fsvg } from './icons.js';

let frame = null;

export function initProfile() {
  frame = makeFrame('profile', {
    title: 'profile', x: 64, y: 60, w: 420, h: 330, minW: 320, minH: 240, hidden: true,
  });
  frame.body.classList.add('profile-body');
  paint();
  bus.on('roster', paint);      // world/avatar facts can drift; repaint is cheap
  return frame;
}

function tile(icon, name, note) {
  return `<button class="pf-tile" data-stub="${name}">
    ${fsvg(icon, 22)}<b>${name}</b><span>${note}</span></button>`;
}

function paint() {
  if (!frame?.visible && frame?.body.dataset.painted) return;
  frame.body.dataset.painted = '1';
  const avatar = (CONFIG.avatar || 'default').split('/').pop().replace(/\.vrm$/i, '');
  frame.body.innerHTML = `
    <div class="pf-id">
      <span class="pf-dot" style="background:${colorFor(CONFIG.name)}"></span>
      <div class="pf-who">
        <b>${escape(CONFIG.name)}</b>
        <span>in <b>${escape(CONFIG.world)}</b> · wearing <b>${escape(avatar)}</b></span>
      </div>
    </div>
    <div class="pf-tiles">
      ${tile('person-arms-spread', 'avatars', 'change what you wear')}
      ${tile('push-pin', 'satchel', 'personal inventory')}
      ${tile('planet', 'worlds', 'places you know')}
      ${tile('users', 'friends', 'people you keep')}
    </div>
    <div class="pf-note">sketch — tiles are stubs; shapes first, plumbing next</div>`;
  frame.body.querySelectorAll('.pf-tile').forEach((b) => {
    b.onclick = () => {
      const n = b.dataset.stub;
      b.classList.add('flashless');
      import('./ui.js').then(({ toast }) => toast(`${n}: not built yet — this tile reserves the spot`, 'info'));
    };
  });
}

const escape = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
