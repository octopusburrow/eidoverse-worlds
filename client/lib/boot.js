// boot — the first fifteen seconds.
//
// Arriving used to be: a black page while 2.1MB of engine parsed, then a dark
// empty grid while ~22MB of body, clips and sky streamed in, with a small
// bottom-right tray of filenames as the only evidence anything was happening.
// Nothing said what was going on, how far along it was, or when you could move.
//
// Three things fix that, in descending order of how much they matter:
//   1. Something on screen IMMEDIATELY — the splash is static markup in
//      index.html, so it paints before any JavaScript has loaded at all.
//   2. Progress measured in real bytes and real phases, never a fake timer.
//   3. The wait made useful: the controls are on the splash, so the time is
//      spent learning them instead of watching a bar.

import { bus } from './base.js';
import { bootBytes } from './assets.js';

// Phase weights are rough shares of a cold boot, measured rather than guessed
// (see the timings in the commit that added this). They only need to be
// approximately right — what must never happen is the bar reaching 100% and
// then sitting there, so `world` and `sky` deliberately hold the tail.
// What the splash covers is "is there somewhere to stand", which is the engine,
// the connection, the folded log, a body, and ground. The sky is deliberately
// NOT here: it arrives over your head a second later, and waiting for it was
// most of a cold boot.
const PHASES = [
  { key: 'engine', label: 'waking the engine', weight: 14 },
  { key: 'connect', label: 'finding the world', weight: 6 },
  { key: 'world', label: 'folding the world log', weight: 40 },
  { key: 'body', label: 'assembling your body', weight: 40 },
];

const state = new Map(PHASES.map((p) => [p.key, 0])); // key -> 0..1
let el = null, bar = null, phaseEl = null, detailEl = null, tipEl = null;
let done = false;
let startedAt = performance.now();
const marks = {};

export function markPhase(key, value = 1) {
  if (done) return;
  const prev = state.get(key) ?? 0;
  if (value <= prev) return;
  state.set(key, Math.min(1, value));
  if (value >= 1 && !marks[key]) marks[key] = Math.round(performance.now() - startedAt);
  paint();
}

function progress() {
  let got = 0, total = 0;
  for (const p of PHASES) { total += p.weight; got += p.weight * (state.get(p.key) ?? 0); }
  return got / total;
}

function currentLabel() {
  for (const p of PHASES) if ((state.get(p.key) ?? 0) < 1) return p.label;
  return 'stepping in';
}

function paint() {
  if (!el || done) return;
  const pct = Math.round(progress() * 100);
  bar.style.width = `${pct}%`;
  el.style.setProperty('--spp', String(progress()));   // drives the mark's assembly
  phaseEl.textContent = currentLabel();
  const b = bootBytes();
  // ALWAYS show the expected total (R, 16:01 — people deserve to know how
  // much they're in for, in case they want to bail). done can overrun the
  // manifest total when late discoveries join; display total grows with it
  // so the fraction stays honest instead of reading 117%.
  const shownTotal = Math.max(b.total, b.done);
  detailEl.textContent = b.total > 0
    ? `${(b.done / 1048576).toFixed(1)} / ${(shownTotal / 1048576).toFixed(1)} MB`
    : '';
}

// Rotating tips — the wait is the best teaching moment the client gets, since
// it's the one time the user is looking at the UI and not at the world.
const TIPS = [
  ['@', 'Type <b>@</b> in chat to mention someone. Agents are pinged by name — and get it even if they were away.'],
  ['/', '<b>/w name message</b> whispers privately. It is never written to the world log.'],
  ['B', 'Press <b>B</b> to search the model library, or drag a <b>.glb</b> straight into the window.'],
  ['↕', 'Click anything placed to select it — drag to move, <b>Q</b>/<b>E</b> to turn, <b>Ctrl+Z</b> to undo.'],
  ['X', 'Press <b>X</b> next to a chair and you will sit <i>on</i> it. Nobody had to make it a chair.'],
  ['P', '<b>P</b> is photo mode: free camera, <b>F1</b> hides the UI, <b>F2</b> saves the shot.'],
  ['▦', 'Every panel moves and resizes. Where you put them is remembered.'],
];
let tipIdx = Math.floor(Math.random() * TIPS.length);
let tipTimer = null;
function rotateTip() {
  if (!tipEl) return;
  tipIdx = (tipIdx + 1) % TIPS.length;
  const [k, text] = TIPS[tipIdx];
  tipEl.innerHTML = `<span class="tipk">${k}</span><span>${text}</span>`;
}

export function initBoot({ world, name }) {
  el = document.getElementById('splash');
  if (!el) return;
  bar = el.querySelector('.sp-bar-fill');
  startLights(el);
  phaseEl = el.querySelector('.sp-phase');
  detailEl = el.querySelector('.sp-detail');
  tipEl = el.querySelector('.sp-tip');
  el.querySelector('.sp-world').textContent = world;
  const v = el.querySelector('.sp-ver'); if (v) v.textContent = el.dataset.build || '';
  el.querySelector('.sp-name').textContent = name;
  startedAt = performance.now();

  rotateTip();
  tipTimer = setInterval(rotateTip, 5200);

  // The engine is already parsed by the time this module runs — that phase is
  // complete by definition, and its duration is measurable from navigation.
  // performance.now() is already ms since navigation, so this IS how long the
  // engine took to arrive and parse — the part of the boot the splash exists to
  // cover, and the part no JavaScript can measure from the inside any earlier.
  markPhase('engine', 1);
  marks.engine = Math.round(performance.now());

  // Byte progress refreshes the numbers even when no phase boundary moves, so
  // the bar never looks frozen during one big download.
  bus.on('loading', paint);

  // An escape hatch, always. A stuck asset must never trap someone outside the
  // world — they can walk in and let the rest arrive around them.
  const skip = el.querySelector('.sp-skip');
  skip.onclick = () => finishBoot('skipped');
  setTimeout(() => { if (!done) skip.classList.add('show'); }, 4000);
  // Hard ceiling: if something never reports, leave anyway.
  setTimeout(() => { if (!done) finishBoot('timeout'); }, 45000);

  paint();
}

export function finishBoot(reason = 'ready') {
  if (done || !el) return;
  done = true;
  clearInterval(tipTimer);
  bar.style.width = '100%';
  el.style.setProperty('--spp', '1');
  phaseEl.textContent = 'welcome';
  el.classList.add('gone');
  stopLights();
  setTimeout(() => { el.style.display = 'none'; }, 620);
  const total = Math.round(performance.now() - startedAt);
  console.log(`[boot] ready in ${total}ms (${reason})`, marks);
  bus.emit('booted', { ms: total, reason, marks });
  releaseBoot?.();
}

export const bootDone = () => done;

// Scenery that isn't gating arrival should also not COMPETE with it. Without
// this the sky's 7.5MB simply moved from blocking the boot to stealing its
// bandwidth, and the body — which arrival does wait for — got slower by almost
// exactly what the sky gained.
let releaseBoot;
const bootGate = new Promise((res) => { releaseBoot = res; });
// Yielding to arrival must never become waiting on it FOREVER. Anything that
// awaits this is background work; if boot is somehow stuck, background work
// proceeding is strictly better than a deadlock, and a deadlock here already
// cost a 45-second join once.
const BOOT_GATE_MAX = 12000;
export const whenBooted = () => (done
  ? Promise.resolve()
  : Promise.race([bootGate, new Promise((r) => setTimeout(r, BOOT_GATE_MAX))]));
bus.on('booted', () => releaseBoot?.());

// ---- the ground lights: faint aurora CURTAINS projected upward from the
// bottom edge (R, 09-05: "bars of light, faint Northern Lights") — a handful
// of tall soft columns, bright at the ground and gone by a third of the way
// up, drifting sideways and breathing in height. Drawn per frame by rAF ON
// PURPOSE: this is the splash's liveness signal — a frozen main thread
// freezes the curtains (a CSS animation would keep going on the compositor
// and lie). Additive blend so overlaps glow rather than stack gray. No
// wrapping: positions ease, never jump (the old `% 1` drift popped when it
// went negative). Reduced-motion slows the whole thing, never stops it.
let lightsRaf = 0;
function startLights(el) {
  const cv = el.querySelector('.sp-lights');
  if (!cv) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
  const g = cv.getContext('2d');
  const off = document.createElement('canvas'); const og = off.getContext('2d');   // per-curtain scratch
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#8fe8c8';
  const N = 7, t0 = performance.now();
  // each curtain: a home x, a slow sway, a width, a height and its own breath
  const C = Array.from({ length: N }, (_, i) => ({
    x0: (i + 0.5) / N, sway: 0.03 + 0.02 * ((i * 5) % 3), ws: (0.25 + 0.1 * ((i * 3) % 4)) * calm, ph: i * 1.9,
    w: 0.07 + 0.05 * ((i * 7) % 3), h: 0.32 + 0.12 * ((i * 11) % 3), hs: (0.4 + 0.12 * ((i * 5) % 3)) * calm,
  }));
  const frame = (now) => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.clearRect(0, 0, w, h);
    const t = (now - t0) / 1000;
    g.globalCompositeOperation = 'lighter';
    for (const c of C) {
      const x = (c.x0 + Math.sin(t * c.ws + c.ph) * c.sway) * w;      // eased sway, never wraps
      const hh = h * (c.h + 0.06 * Math.sin(t * c.hs + c.ph * 1.3));  // breathing height
      const hw = w * c.w * (1 + 0.15 * Math.sin(t * c.ws * 0.7 + c.ph)) / 2;
      // vertical fade: bright at the ground, gone at the top of the curtain
      const vg = g.createLinearGradient(0, h, 0, h - hh);
      vg.addColorStop(0, brand); vg.addColorStop(0.55, brand); vg.addColorStop(1, 'rgba(0,0,0,0)');
      // horizontal softness: a curtain has no hard sides — fade across the width
      const hg = g.createLinearGradient(x - hw, 0, x + hw, 0);
      hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.5, 'rgba(255,255,255,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      // compose ONE curtain on the scratch canvas (vertical fade, then the
      // horizontal softness as a destination-in mask — on the main canvas that
      // mask would erase the curtains already drawn), then add it
      if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
      og.clearRect(x - hw - 1, h - hh - 1, hw * 2 + 2, hh + 2);
      og.globalCompositeOperation = 'source-over';
      og.fillStyle = vg; og.fillRect(x - hw, h - hh, hw * 2, hh);
      og.globalCompositeOperation = 'destination-in';
      og.fillStyle = hg; og.fillRect(x - hw, h - hh, hw * 2, hh);
      g.globalAlpha = 0.15;
      g.drawImage(off, x - hw, h - hh, hw * 2, hh, x - hw, h - hh, hw * 2, hh);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    lightsRaf = requestAnimationFrame(frame);
  };
  lightsRaf = requestAnimationFrame(frame);
}
function stopLights() { if (lightsRaf) cancelAnimationFrame(lightsRaf); lightsRaf = 0; }
