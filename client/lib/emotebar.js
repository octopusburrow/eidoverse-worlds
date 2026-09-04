// The emote menu. Emotes were number keys and a slash command — invisible
// unless you read the help. On a performance platform the gestures should be
// somewhere you can see them: six tiles, the gesture as content, its name, and
// the key that fires it. The playing emote is lit. House .tile/.tiles rules
// only — no private layout here (R, 09-04: this file had been hand-rolled).

import { makeFrame } from './frames.js';
import { EMOTE_ORDER } from './avatar.js';
import { myState } from './controller.js';
import { getMe } from './mybody.js';

// emoji here are CONTENT (the gesture itself), not chrome — the fill-icon set
// has no gesture glyphs beyond a wave, and a drawn set is still an open question.
const GLYPH = { wave: '👋', cheer: '🙌', dance: '💃', point: '👉', salute: '🫡', clap: '👏' };

export function initEmoteBar() {
  const f = makeFrame('emotes', {
    title: 'emotes', x: -252, y: -10, w: 246, h: 190, minW: 180, minH: 120, hidden: true,
  });
  const grid = document.createElement('div');
  grid.className = 'tiles cols-3';
  const tiles = new Map();
  EMOTE_ORDER.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.emote = name;
    b.title = `${name} — key ${i + 1}`;
    b.innerHTML = `<span class="tile-glyph">${GLYPH[name] ?? '✨'}</span><b>${name}</b><kbd>${i + 1}</kbd>`;
    b.onclick = () => { getMe()?.playEmote(name); myState.emote = name; paint(); };
    grid.appendChild(b);
    tiles.set(name, b);
  });
  const paint = () => { for (const [n, b] of tiles) b.classList.toggle('on', myState.emote === n); };
  setInterval(paint, 500);   // number keys set myState.emote elsewhere; the lit tile follows
  f.body.appendChild(grid);
  return f;
}
