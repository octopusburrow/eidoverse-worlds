// The emote menu. Emotes were number keys and a slash command — invisible
// unless you read the help. On a performance platform the gestures should be
// somewhere you can see them: six tiles, the gesture as content, its name, and
// the key that fires it. The playing emote is lit. House .tile/.tiles rules
// only — no private layout here (R, 09-04: this file had been hand-rolled).

import { makeFrame } from './frames.js';
import { EMOTE_ORDER, EMOTE_ICONS } from './avatar.js';
import { myState } from './controller.js';
import { getMe } from './mybody.js';
import { registerXRPanel } from './xrpanels.js';
import { bus } from './base.js';

// emoji here are CONTENT (the gesture itself), not chrome — the fill-icon set
// has no gesture glyphs beyond a wave; the def-hydrated EMOTE_ICONS table wins,
// this map is the fallback for a vocabulary that ships no icon.
const GLYPH = { wave: '👋', cheer: '🙌', dance: '💃', point: '👉', salute: '🫡', clap: '👏' };

export function initEmoteBar() {
  // geometry the CSS owns too: .tiles.fixed → 68px tiles, 6px gap, 8px body pad
  const TILE = 40, GAP = 5, PAD = 7, ROW_H = 40;   // glyph-only tiles; name + key are the tooltip (R, 09-04)
  const widthFor = (cols) => cols * TILE + (cols - 1) * GAP + PAD * 2 + 2;   // +2: frame edges
  const rowsFor = (cols) => Math.ceil(EMOTE_ORDER.length / cols);
  // state.h is the body's CONTENT height (frames.js paints body.style.height; the body
  // pads 7px top+bottom on top of it) — so rows + gaps only, no pad term
  const heightFor = (cols) => rowsFor(cols) * ROW_H + (rowsFor(cols) - 1) * GAP;
  let snapT = null;
  const f = makeFrame('emotes', {
    title: 'emotes', x: -(widthFor(6) + 6), y: -10, w: widthFor(6), h: heightFor(6),   // one row of six by default
    minW: widthFor(3), minH: heightFor(6), hidden: true,   // 3..6 across
    // SNAP TO WHOLE TILES on release: drag the frame to any width, and when the
    // drag settles it fits itself to the tiles that row holds (R, 09-04). The
    // frame owns its size, so we write its state and repaint through the refs it
    // exposes for exactly this kind of rider.
    onResize: (w) => { clearTimeout(snapT); snapT = setTimeout(() => snapTo(w), 180); },
  });
  const snapTo = (w) => {
    const cols = Math.max(3, Math.min(EMOTE_ORDER.length, Math.floor((w - PAD * 2 - 2 + GAP) / (TILE + GAP))));
    f._state.w = widthFor(cols); f._state.h = heightFor(cols); f._paint();
  };
  // a saved size from an older layout (or any drift) refits the moment the menu opens
  const show = f.show.bind(f);
  f.show = () => { show(); snapTo(f._state.w); return f; };
  const grid = document.createElement('div');
  grid.className = 'tiles fixed';
  const tiles = new Map();
  // built from the def-hydrated vocabulary (§24l) and rebuilt when a defs
  // push re-hydrates it — icons ride the same table as the names now
  const fill = () => {
    grid.innerHTML = ''; tiles.clear();
    EMOTE_ORDER.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.emote = name;
      b.title = `${name} — key ${i + 1}`;
      b.innerHTML = `<span class="tile-glyph">${EMOTE_ICONS[name] ?? GLYPH[name] ?? '✨'}</span>`;
      b.onclick = () => { getMe()?.playEmote(name); myState.emote = name; paint(); };
      grid.appendChild(b);
      tiles.set(name, b);
    });
    if (f._state) snapTo(f._state.w);
  };
  const paint = () => { for (const [n, b] of tiles) b.classList.toggle('on', myState.emote === n); };
  fill();
  bus.on('emotes-updated', fill);
  setInterval(paint, 500);   // number keys set myState.emote elsewhere; the lit tile follows
  f.body.appendChild(grid);
  // the same six gestures as a VR quad — one button per emote, the same call
  registerXRPanel({
    id: 'emotes', title: 'emotes',
    fields: () => EMOTE_ORDER.map((name) => ({ t: 'btn', k: name, label: name })),   // names, not emoji: a canvas fillText of a missing glyph paints NOTHING
    dispatch: (k) => { if (EMOTE_ORDER.includes(k)) { getMe()?.playEmote(k); myState.emote = k; } },
  });
  return f;
}
