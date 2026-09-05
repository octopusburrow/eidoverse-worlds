// bodies — choose what you wear, declared ONCE as fields and rendered twice:
// a section of the profile frame (renderDOM) and part of the profile quad, both dispatching
// into the same switchAvatar the palette's cards call. R, 09-04 23:59: "the
// exact same panels in Desktop mode — hopefully we only need to maintain
// ONE set of menus"; and 22:57: a body is never optional — this is the
// in-headset way to pick one when the default is not what you want.
import { bus } from './base.js';
import { net } from './net.js';
import { renderDOM } from './panels.js';
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

// The bodies list lives INSIDE the profile (R, 09-05: reachable from
// profile, not its own menu). profile.js mounts it under the avatars tile
// and folds its fields into the profile quad.
export const bodiesFields = fields;
export const bodiesDispatch = dispatch;
export function mountBodies(host) {
  host.classList.add('schema-panel');
  const scroll = document.createElement('div');
  scroll.className = 'schema-scroll';
  host.append(scroll);
  const repaint = () => renderDOM(scroll, fields(), dispatch);
  repaint();
  bus.on('avatars', repaint);
  bus.on('avatar-worn', repaint);
  return repaint;
}
