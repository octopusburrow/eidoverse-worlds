// bodies — choose what you wear, declared ONCE as fields and rendered twice:
// a desktop frame (renderDOM) and a VR quad (renderCanvas), both dispatching
// into the same switchAvatar the palette's cards call. R, 09-04 23:59: "the
// exact same panels in Desktop mode — hopefully we only need to maintain
// ONE set of menus"; and 22:57: a body is never optional — this is the
// in-headset way to pick one when the default is not what you want.
import { bus } from './base.js';
import { net } from './net.js';
import { registerPanel } from './ui.js';
import { renderDOM } from './panels.js';
import { registerXRPanel } from './xrpanels.js';
import { switchAvatar } from './palette.js';
import { getMyAvatarName, getMyAvatarPath } from './mybody.js';

function fields() {
  const worn = getMyAvatarName();
  const wornPath = String(getMyAvatarPath() ?? '').split('?')[0];
  const list = net.avatars ?? [];
  return [
    { t: 'info', label: 'wearing', value: worn ?? '—' },
    { t: 'list', label: 'bodies', empty: 'no bodies known yet — the roster arrives with the world',
      rows: list.map((a) => ({
        id: a.name, label: a.name,
        sub: a.height ? `${a.height.toFixed(2)} m` : undefined,
        active: a.name === worn || String(a.path ?? '').split('?')[0] === wornPath,
        actions: [{ k: 'wear', label: 'wear' }],
      })) },
  ];
}
function dispatch(k, id) {
  if (k !== 'wear' && k !== 'row') return;
  const a = (net.avatars ?? []).find((x) => x.name === id);
  if (a) switchAvatar(a.path, a.name);
}

export function initBodies() {
  let scroll = null;
  const repaint = () => { if (scroll) renderDOM(scroll, fields(), dispatch); bus.emit('xr:repaint'); };
  registerPanel({
    id: 'bodies', icon: 'person-arms-spread', title: 'bodies', w: 280, h: 320,
    mount: (body) => {
      body.classList.add('schema-panel');
      scroll = document.createElement('div');
      scroll.className = 'schema-scroll';
      body.append(scroll);
      renderDOM(scroll, fields(), dispatch);
    },
  });
  registerXRPanel({ id: 'bodies', title: 'bodies', fields, dispatch });
  bus.on('avatars', repaint);
  bus.on('avatar-worn', repaint);
}
