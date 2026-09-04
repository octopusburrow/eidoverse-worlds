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
  // geometry the CSS owns too: .tiles.fixed → 68px tiles, 6px gap, 8px body pad
  const TILE = 40, GAP = 5, PAD = 7, ROW_H = 40;   // glyph-only tiles; name + key are the tooltip (R, 09-04)
  const widthFor = (cols) => cols * TILE + (cols - 1) * GAP + PAD * 2 + 2;   // +2: frame edges
  const rowsFor = (cols) => Math.ceil(EMOTE_ORDER.length / cols);
  const heightFor = (cols) => rowsFor(cols) * ROW_H + (rowsFor(cols) - 1) * GAP + PAD * 2;   // no head term: the frame head measures 0 (hidden until hover)
  let snapT = null;
  const f = makeFrame('emotes', {
    title: 'emotes', x: -(widthFor(6) + 6), y: -10, w: widthFor(6), h: heightFor(6),   // one row of six by default
    minW: widthFor(2), minH: heightFor(6), hidden: true,
    // SNAP TO WHOLE TILES on release: drag the frame to any width, and when the
    // drag settles it fits itself to the tiles that row holds (R, 09-04). The
    // frame owns its size, so we write its state and repaint through the refs it
    // exposes for exactly this kind of rider.
    onResize: (w) => {
      clearTimeout(snapT);
      snapT = setTimeout(() => {
        const cols = Math.max(2, Math.min(EMOTE_ORDER.length, Math.floor((w - PAD * 2 - 2 + GAP) / (TILE + GAP))));
        f._state.w = widthFor(cols); f._state.h = heightFor(cols); f._paint();
      }, 180);
    },
  });
  const grid = document.createElement('div');
  grid.className = 'tiles fixed';
  const tiles = new Map();
  EMOTE_ORDER.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.dataset.emote = name;
    b.title = `${name} — key ${i + 1}`;
    b.innerHTML = `<span class="tile-glyph">${GLYPH[name] ?? '✨'}</span>`;
    b.onclick = () => { getMe()?.playEmote(name); myState.emote = name; paint(); };
    grid.appendChild(b);
    tiles.set(name, b);
  });
  const paint = () => { for (const [n, b] of tiles) b.classList.toggle('on', myState.emote === n); };
  setInterval(paint, 500);   // number keys set myState.emote elsewhere; the lit tile follows
  f.body.appendChild(grid);
  return f;
}
