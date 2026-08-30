// hud — now the ∃ mark. The status BAR is gone (R + the dev channel, 08-29):
// identity lives in Profile-to-be, fps lives in debug, the people list lives
// behind the ∃ menu and the rail. What survives here is what must be ambient:
// connection truth (mark dims + pulses when the socket is down) and the
// editing flag (warn dot). The mic/ear glyphs anchor themselves to this
// element's right edge (mictoggle.js) — inboard of the corner, per spec.
// Painted at 1Hz by the pulse system.

import { net } from './net.js';
import { isEditing } from './build.js';

export function paintHud() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  hud.classList.toggle('net-down', net.status !== 'live');
  hud.classList.toggle('editing', isEditing());
  hud.title = net.status === 'live'
    ? 'eidoverse — menu'
    : `eidoverse — ${net.status}…`;
}
