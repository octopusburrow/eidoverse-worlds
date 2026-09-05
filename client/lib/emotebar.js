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
import { fsvg, svg } from './icons.js';
import { setPosture } from './controller.js';
const POSTURES = ['sit', 'stand', 'lie'];
// through the same flows the ring used: a nearby seat wins for sit, stand dismounts
function posture(k) {
  if (k === 'sit') bus.emit('xr:sit');
  else if (k === 'stand') bus.emit('xr:stand');
  else setPosture('lie');
}
import { bus } from './base.js';

// emoji here are CONTENT (the gesture itself), not chrome — the fill-icon set
// has no gesture glyphs beyond a wave; the def-hydrated EMOTE_ICONS table wins,
// this map is the fallback for a vocabulary that ships no icon.
const GLYPH = { wave: '👋', cheer: '🙌', dance: '💃', point: '👉', salute: '🫡', clap: '👏' };

export function initEmoteBar() {
  // geometry the CSS owns too: .tiles.fixed → 68px tiles, 6px gap, 8px body pad
  const TILE = 40, GAP = 5, PAD = 7, ROW_H = 40;   // glyph-only tiles; name + key are the tooltip (R, 09-04)
  const widthFor = (cols) => cols * TILE + (cols - 1) * GAP + PAD * 2 + 2;   // +2: frame edges
  const POSTURE_TILES = 3;   // sit / stand / lie lead the grid (R, 09-05) — they count toward the rows
  const rowsFor = (cols) => Math.ceil((POSTURE_TILES + EMOTE_ORDER.length) / cols);
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
    // postures lead the row as tiles like the rest — EMOJI, same as the emotes
    // (R, 09-05 16:41: "STILL have phosphor icons instead of emojis"); the same
    // measured fallback: a platform without the glyph gets the word
    for (const [k, em] of [['sit', '🪑'], ['stand', '🧍'], ['lie', '🛏️']]) {
      const b = document.createElement('button');
      b.className = 'tile posture';
      b.dataset.posture = k;
      b.title = k;
      b.innerHTML = emojiRenders(em) ? `<span class="tile-glyph">${em}</span>` : `<span class="tile-word">${k}</span>`;
      b.onclick = () => { posture(k); paint(); };
      grid.appendChild(b);
      tiles.set(`posture:${k}`, b);
    }
    EMOTE_ORDER.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'tile';
      b.dataset.emote = name;
      b.title = `${name} — key ${i + 1}`;
      // emoji are content here (the gesture itself) — but a platform missing the
      // glyph paints a tofu box or nothing, so the tile falls back to the word
      // when the emoji measurably does not render (R, 09-05)
      const em = EMOTE_ICONS[name] ?? GLYPH[name] ?? '✨';
      b.innerHTML = emojiRenders(em) ? `<span class="tile-glyph">${em}</span>` : `<span class="tile-word">${name}</span>`;
      b.onclick = () => { getMe()?.playEmote(name); myState.emote = name; paint(); };
      grid.appendChild(b);
      tiles.set(name, b);
    });
    if (f._state) snapTo(f._state.w);
  };
  const paint = () => { for (const [n, b] of tiles) b.classList.toggle('on', n.startsWith('posture:') ? myState.clip === n.slice(8) : myState.emote === n); };
  fill();
  bus.on('emotes-updated', fill);
  // (postures are tiles in the grid above — one row, one grammar)
  setInterval(paint, 500);   // number keys set myState.emote elsewhere; the lit tile follows
  f.body.appendChild(grid);
  // the same six gestures as a VR quad — one button per emote, the same call
  registerXRPanel({
    id: 'emotes', title: 'emotes',
    // postures lead (R, 09-04 22:02: sit/lie belong to the emote menu, not the
    // ring); then the emotes — names, not emoji: a canvas fillText of a
    // missing glyph paints nothing
    fields: () => [...POSTURES.map((k) => ({ t: 'btn', k, label: k })), ...EMOTE_ORDER.map((name) => ({ t: 'btn', k: name, label: name }))],
    dispatch: (k) => { if (POSTURES.includes(k)) posture(k); else if (EMOTE_ORDER.includes(k)) { getMe()?.playEmote(k); myState.emote = k; } },
  });
  return f;
}

// Does this emoji actually draw here? Paint it on a scratch canvas and look
// for COLOUR: a rendered emoji has chroma, a tofu box / missing glyph paints
// gray-on-nothing (or nothing). Cached per string; a false answer costs a
// word instead of a box.
const emojiCache = new Map();
function emojiRenders(s) {
  if (emojiCache.has(s)) return emojiCache.get(s);
  let ok = true;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 24;
    const g = cv.getContext('2d');
    g.textBaseline = 'top'; g.font = '20px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.fillStyle = '#000'; g.fillText(s, 0, 0);
    const d = g.getImageData(0, 0, 24, 24).data;
    let chroma = 0, ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue; ink++;
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx - mn > 24) chroma++;
    }
    ok = ink > 0 && chroma > 4;   // some coloured pixels = a real emoji; monochrome = tofu or a text glyph
  } catch { ok = true; }
  emojiCache.set(s, ok);
  return ok;
}
