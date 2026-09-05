// profile — the PERSON noun's home (four-noun taxonomy, 08-29): who you are,
// where you are, what you're wearing, what you carry, who you know.
// DELIBERATELY A SKETCH (R, 22:01): real satchel/worlds/friends need server
// surfaces that don't exist yet; this stakes out the shape, VRChat-ish —
// a bigger panel, identity up top, destination tiles below.

import { CONFIG, bus, colorFor } from './base.js';
import { registerXRPanel } from './xrpanels.js';
import { getMyAvatarName } from './mybody.js';
import { bodiesFields, bodiesDispatch, mountBodies } from './bodies.js';
import { presence, setPresence, STATES } from './presence.js';
import { renderDOM } from './panels.js';
import { makeFrame } from './frames.js';
import { fsvg } from './icons.js';
import { toast } from './ui.js';

let frame = null;

// the profile as a VR quad: who you are, your presence, and the bodies list
// (folded in from bodies.js — one declaration, shown here on both surfaces).
function profileFields() {
  return [
    { t: 'info', label: 'name', value: CONFIG.name ?? '—' },
    { t: 'info', label: 'world', value: CONFIG.world ?? '—' },
    { t: 'list', label: 'presence', rows: STATES.map((st) => ({ id: st, label: st, active: presence() === st, actions: presence() === st ? [] : [{ k: 'presence', label: 'set' }] })) },
    ...bodiesFields(),
  ];
}
function profileDispatch(k, v) {
  if (k === 'presence') { setPresence(v); bus.emit('xr:repaint'); return; }
  bodiesDispatch(k, v);
}

export function initProfile() {
  registerXRPanel({ id: 'profile', title: 'profile', fields: profileFields, dispatch: profileDispatch });
  frame = makeFrame('profile', {
    title: 'profile', x: 64, y: 60, w: 420, h: 440, minW: 320, minH: 300, hidden: true,   // id + presence + four tiles + note
  });
  frame.body.classList.add('profile-body');
  paint();
  bus.on('roster', paint);      // world/avatar facts can drift; repaint is cheap
  bus.on('presence:me', () => { if (frame.visible) paint(); bus.emit('xr:repaint'); });
  return frame;
}

function tile(icon, name, note) {
  return `<button class="tile" data-stub="${name}">
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
    <div class="pf-presence"></div>
    <div class="tiles">
      ${tile('person-arms-spread', 'avatars', 'change what you wear')}
      ${tile('push-pin', 'satchel', 'personal inventory')}
      ${tile('planet', 'worlds', 'places you know')}
      ${tile('users', 'friends', 'people you keep')}
    </div>
    <div class="pf-bodies" hidden></div>
    <div class="pf-note">satchel · worlds · friends are stubs — shapes first, plumbing next</div>`;
  // presence: the same three the quad offers, as the house's own rows
  renderDOM(frame.body.querySelector('.pf-presence'),
    [{ t: 'list', label: 'presence', rows: STATES.map((st) => ({ id: st, label: st, active: presence() === st, actions: presence() === st ? [] : [{ k: 'presence', label: 'set' }] })) }],
    (k, v) => { if (k === 'presence') { setPresence(v); paint(); } });
  // avatars: the bodies list unfolds in place (bodies.js, one declaration)
  const bodiesHost = frame.body.querySelector('.pf-bodies');
  frame.body.querySelectorAll('.tile').forEach((b) => {
    b.onclick = () => {
      const n = b.dataset.stub;
      if (n === 'avatars') {
        bodiesHost.hidden = !bodiesHost.hidden;
        if (!bodiesHost.hidden && !bodiesHost.dataset.mounted) { bodiesHost.dataset.mounted = '1'; mountBodies(bodiesHost); }
        return;
      }
      toast(`${n}: not built yet — this tile reserves the spot`, 'info');
    };
  });
}

const escape = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
