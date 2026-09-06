// Settings › VR (R, 09-05 18:22: "add VR to the Settings — smooth turning,
// vignette, mirror VR view to desktop, 3rd person"). One section on the
// video panel's grammar; prefs live in xr.js (xrPrefs / setXrPref) so the
// frame loop reads them without a round trip. Visible whether or not a
// headset is sensed — the first row says which, so the rest make sense.
import { makeSection, flashHint } from './ui.js';
import { checkRow, selectRow } from './rows.js';
import { xrPrefs, setXrPref } from './xr.js';
import { xrGlyphAvailable } from './mictoggle.js';

export function initVRPanel() {
  makeSection('🥽 VR', (body) => {
    if (body.dataset.init) return;
    body.dataset.init = '1';

    const sensed = xrGlyphAvailable();
    const note = document.createElement('div');
    note.className = 'row';
    const span = document.createElement('span'); span.className = 'note'; note.appendChild(span);
    span.textContent = sensed
      ? 'A headset can present from this browser. The visor glyph in the HUD enters and leaves VR.'
      : 'No headset sensed. Chrome finds the OpenXR runtime only at browser start — if SteamVR came up after Chrome, use chrome://restart. These settings apply once one is found.';
    body.appendChild(note);

    // rows.js: selectRow(label, options, value, onChange) RETURNS { row, select }; checkRow(label, get, set) returns the element
    const { row: turn } = selectRow('turning', [['snap', 'snap (30°)'], ['smooth', 'smooth']], xrPrefs.turn,
      (v) => { setXrPref('turn', v); flashHint(`VR turning: ${v}`); });
    turn.title = 'snap: the world pivots 30° per stick flick — the comfort default. smooth: continuous, like a desktop mouse.';
    body.appendChild(turn);

    const vig = checkRow('comfort vignette', () => !!xrPrefs.vignette,
      (on) => { setXrPref('vignette', !!on); flashHint(`VR vignette ${on ? 'on' : 'off'}`); });
    vig.title = 'darkens the edges of your view while you move or turn on the stick; opens again when you stop.';
    body.appendChild(vig);

    const { row: mir } = selectRow('desktop view', [['off', 'off (black)'], ['first', 'mirror my eyes'], ['third', 'third person']], xrPrefs.mirror,
      (v) => { setXrPref('mirror', v); flashHint(`desktop view: ${v}`); });
    mir.title = 'what the browser window shows while you are in the headset. off costs nothing; the others draw one extra frame per tick.';
    body.appendChild(mir);
  }, { id: 'vr', host: 'settings' });
}
