// icons — one Lucide registry, three renderers, no font dependency anywhere.
//
// WHY THIS EXISTS (R, 00:19: "replace all the icons if you can"): canvas
// `fillText` of an emoji silently paints NOTHING when the platform lacks that
// glyph. No error, no fallback, no warning — just a UI element that means
// something and shows nothing. It happened live on a Windows 11 desktop with
// two different codepoints, BOTH of which rasterized correctly in headless
// Chromium, so the fault was invisible to the tests as well as to me. Any
// emoji that carries meaning in this UI is a silent-failure risk.
//
// Path data is verbatim from lucide-icons/lucide (ISC licence), 24x24 viewBox.
// Same technique as porch-old's PORCH_ICONS: store the `d` strings, build
// Path2D lazily, and let each surface render them its own way.
//
//   stroke(ctx, name, size)  → canvas / 3D sprite (Path2D, cached)
//   svg(name, size)          → inline <svg> markup for DOM chrome
//   has(name)                → registry probe
//
// Adding an icon: curl the SVG from
// raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg and
// paste its path `d` strings here. Do NOT hand-draw replacements — that was
// tried first and read as blobs at 26px.

const P = {
  ear: ['M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0',
        'M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4'],
  // lucide `brain` (R, 08-05, third pass: bubble-with-dots read as silence,
  // pencil read as "edit"). Denser than the other glyphs at pill size — if it
  // reads as mush in-world, the next stop is bare `ellipsis`.
  think: ['M12 18V5',
          'M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4',
          'M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5',
          'M17.997 5.125a4 4 0 0 1 2.526 5.77',
          'M18 18a4 4 0 0 0 2-7.464',
          'M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517',
          'M6 18a4 4 0 0 1-2-7.464',
          'M6.003 5.125a4 4 0 0 0-2.526 5.77'],
  wrench: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z'],
  mic: ['M12 19v3', 'M19 10v2a7 7 0 0 1-14 0v-2'],
  messageSquare: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z'],
  boxes: ['M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z',
          'm7 16.5-4.74-2.85', 'm7 16.5 5-3', 'M7 16.5v5.17',
          'M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
          'M16 3.128a4 4 0 0 1 0 7.744', 'M22 21v-2a4 4 0 0 0-3-3.87',
          'M10 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
  hand: ['M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2', 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
         'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
         'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'],
  bug: ['M12 20v-9', 'M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z',
        'M14.12 3.88 16 2', 'M21 21a4 4 0 0 0-3.81-4', 'M21 5a4 4 0 0 1-3.55 3.97',
        'M22 13h-4', 'M3 21a4 4 0 0 1 3.81-4', 'M3 5a4 4 0 0 0 3.55 3.97', 'M6 13H2'],

  // ---- 2026-08-06 sweep: every UI emoji becomes a drawn glyph ----
  armchair: ["M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3", "M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z", "M5 18v2", "M19 18v2"],
  asterisk: ["M12 6v12", "M17.196 9 6.804 15", "m6.804 9 10.392 6"],
  backpack: ["M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M8 10h8", "M8 18h8", "M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6", "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"],
  check: ["M20 6 9 17l-5-5"],
  glasses: ["M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2", "M2.5 13 5 7c.7-1.3 1.4-2 3-2", "M21.5 13 19 7c-.7-1.3-1.5-2-3-2", "M 2.0 15.0 a 4.0 4.0 0 1 0 8.0 0 a 4.0 4.0 0 1 0 -8.0 0", "M 14.0 15.0 a 4.0 4.0 0 1 0 8.0 0 a 4.0 4.0 0 1 0 -8.0 0"],
  headphones: ["M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"],
  leaf: ["M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z", "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"],
  lightbulb: ["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M 3.0 11.0 h 18.0 v 11.0 h -18.0 z"],
  lockOpen: ["M7 11V7a5 5 0 0 1 9.9-1", "M 3.0 11.0 h 18.0 v 11.0 h -18.0 z"],
  maximize: ["M8 3H5a2 2 0 0 0-2 2v3", "M21 8V5a2 2 0 0 0-2-2h-3", "M3 16v3a2 2 0 0 0 2 2h3", "M16 21h3a2 2 0 0 0 2-2v-3"],
  pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
  personStanding: ["m9 20 3-6 3 6", "m6 8 6 2 6-2", "M12 10v4", "M 11.0 5.0 a 1.0 1.0 0 1 0 2.0 0 a 1.0 1.0 0 1 0 -2.0 0"],
  pin: ["M12 17v5", "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"],
  puzzle: ["M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"],
  scrollText: ["M15 12h-5", "M15 8h-5", "M19 17V5a2 2 0 0 0-2-2H4", "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"],
  settings: ["M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915", "M 9.0 12.0 a 3.0 3.0 0 1 0 6.0 0 a 3.0 3.0 0 1 0 -6.0 0"],
  sparkles: ["M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z", "M20 2v4", "M22 4h-4", "M 2.0 20.0 a 2.0 2.0 0 1 0 4.0 0 a 2.0 2.0 0 1 0 -4.0 0"],
  sprout: ["M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3", "M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4", "M5 21h14"],
  sun: ["M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41", "M 8.0 12.0 a 4.0 4.0 0 1 0 8.0 0 a 4.0 4.0 0 1 0 -8.0 0"],
  tent: ["M3.5 21 14 3", "M20.5 21 10 3", "M15.5 21 12 15l-3.5 6", "M2 21h20"],
  trees: ["M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z", "M7 16v6", "M13 19v3", "M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"],
  triangleAlert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
  volume2: ["M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z", "M16 9a5 5 0 0 1 0 6", "M19.364 18.364a9 9 0 0 0 0-12.728"],
  volumeX: ["M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z", "M 22 9 L 16 15", "M 16 9 L 22 15"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  zap: ["M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"],
};

// rounded-rect ops that some icons need beyond their paths: [x,y,w,h,rx]
const RECT = { mic: [9, 2, 6, 13, 3] };

const _cache = new Map();
function paths(name) {
  if (!_cache.has(name)) {
    const list = (P[name] ?? []).map((d) => new Path2D(d));
    const r = RECT[name];
    if (r) { const q = new Path2D(); q.roundRect(...r); list.push(q); }
    _cache.set(name, list);
  }
  return _cache.get(name);
}

export const has = (name) => !!P[name];

/** Stroke a Lucide icon centred on the current origin, sized to `size` px. */
export function stroke(ctx, name, size = 26) {
  if (!P[name]) return false;
  const k = size / 24;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-12, -12);
  ctx.lineWidth = 2 / k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of paths(name)) ctx.stroke(path);
  ctx.restore();
  return true;
}

/** Inline SVG markup for DOM chrome — same registry, different surface. */
export function svg(name, size = 18) {
  const d = P[name];
  if (!d) return '';
  const r = RECT[name];
  const rect = r ? `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="${r[4]}"/>` : '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${d.map((p) => `<path d="${p}"/>`).join('')}${rect}</svg>`;
}
