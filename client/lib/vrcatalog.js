// vrcatalog — the build catalog as a fields() schema, so the SAME curated
// starter vocabulary the desktop palette shows can ride an xrpanels quad and
// be spawned by laser. v1 is deliberately the starters only: search needs
// text entry, and VR text entry (the vkb) is a later slice — a doorway,
// not a limit, same doctrine as the STARTER list itself.
//
// Spawning here is the whole desktop ghost-flow collapsed to one honest verb:
// the thing lands 1.6m ahead of your body, facing you, and undo can unsay it.
// (No ghost in VR yet — the grab chord already covers "then nudge it".)

import { STARTER } from './build.js';
import { sendVerb } from './net.js';
import { myState, camYaw } from './controller.js';
import { recordPair } from './editundo.js';
import { flashHint } from './ui.js';

export function catalogFields() {
  return [
    { t: 'info', label: 'catalog', value: 'laser a name to spawn it' },
    {
      t: 'list', label: 'starters', empty: 'no catalog',
      items: STARTER.map(([name, path]) => ({
        id: path, label: name, sub: '',
        actions: [{ k: 'vr-spawn', label: 'spawn' }],
      })),
    },
  ];
}

export function catalogDispatch(action, payload) {
  if (action !== 'vr-spawn' && action !== 'item') return;
  const path = payload?.id ?? payload;
  if (!path) return;
  const entry = STARTER.find(([, p]) => p === path);
  if (!entry) return;
  const id = crypto.randomUUID().slice(0, 8);
  // ahead of the body, on the body's ground height — the server's collider
  // fold settles it onto whatever is actually there
  const yaw = camYaw;
  const pos = [
    +(myState.pos.x - Math.sin(yaw) * 1.6).toFixed(2),
    +myState.pos.y.toFixed(2),
    +(myState.pos.z - Math.cos(yaw) * 1.6).toFixed(2),
  ];
  recordPair({ verb: 'remove', args: { id } }, { verb: 'spawn', args: { id, lib: path, pos, yaw: 0 } });
  sendVerb('spawn', { id, lib: path, pos, yaw: 0 });
  flashHint(`spawned ${entry[0]}`);
}
