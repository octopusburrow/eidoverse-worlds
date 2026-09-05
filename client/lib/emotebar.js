// The emote bar. Emotes were number keys and a slash command — invisible
// unless you read the help. On a performance platform the gestures should be
// somewhere you can see them.

import { makeFrame } from './frames.js';
import { EMOTE_ORDER, EMOTE_ICONS } from './avatar.js';
import { myState } from './controller.js';
import { getMe } from './mybody.js';
import { bus } from './base.js';
import { registerXRPanel } from './xrpanels.js';

export function initEmoteBar() {
  const f = makeFrame('emotes', {
    title: 'emotes', x: -252, y: -10, w: 232, h: 44, minW: 120, minH: 34, hidden: true,
  });
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; padding:7px;';
  // built from the def-hydrated vocabulary (§24l) and rebuilt when a defs
  // push re-hydrates it — icons ride the same table as the names now
  const fill = () => {
    wrap.innerHTML = '';
    EMOTE_ORDER.forEach((name, i) => {
      const b = document.createElement('button');
      b.textContent = `${EMOTE_ICONS[name] ?? '✨'}`;
      b.title = `${name}  (${i + 1})`;
      // emoji here are CONTENT (the gesture itself), so they stay — but at a
      // size that reads. Drawn glyphs for these are an open question (R, 22:06).
      b.className = 'keybtn';   // keyboard-tied action: a visible key-cap, not an outline
      b.style.cssText = 'font-size:19px; line-height:1; padding:6px 8px;';
      b.onclick = () => { getMe()?.playEmote(name); myState.emote = name; };
      wrap.appendChild(b);
    });
  };
  fill();
  bus.on('emotes-updated', fill);
  f.body.appendChild(wrap);
  // the same six gestures as a VR quad — one button per emote, the same call
  registerXRPanel({
    id: 'emotes', title: 'emotes',
    fields: () => EMOTE_ORDER.map((name) => ({ t: 'btn', k: name, label: `${ICON[name] ?? ''} ${name}`.trim() })),
    dispatch: (k) => { if (EMOTE_ORDER.includes(k)) { getMe()?.playEmote(k); myState.emote = k; } },
  });
  return f;
}
