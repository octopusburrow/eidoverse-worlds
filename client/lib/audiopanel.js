// audiopanel — the audio section: three category sliders, one consent row.
//
// This is where the categories live, and why they are HERE rather than behind
// a press-and-hold on the HUD toggle: volume is taste you set once, so it
// belongs on a settings row you can find, not a hidden gesture you cannot.
// (A hold-menu also does not survive VR, where the panel is a quad you point
// a laser at — a list of rows works there, a long-press does not.)
//
// Categories:
//   voices — other people's speech, and agent TTS. A resident is a resident.
//   world  — place sound. Not touched by the 🎧 toggle, on purpose.
//   TTS    — synthetic speech specifically, for anyone who wants people but
//            not narration (or the reverse).

import { makeSection, flashHint } from './ui.js';
import { ttsSection } from './ttsrow.js';
import { audioPrefs, setVolume, receivingVoice, setReceiveVoice,
  sttConsented, setSttConsent, isHushed, setHush,
  micFloor, setMicFloor, meterPos, gateThreshold } from './voiceconsent.js';
import { ttsAvailable, ttsVoiceName, isTtsEnabled, setTtsEnabled, setTtsSource } from './voicesource.js';
import { report, CONFIG } from './core.js';
import { micAnalyserLevel, micOn, toggleMic, setSelfMonitor, selfMonitoring,
         micGateInfo } from './voice.js';
import { bus } from './core.js';

// The panel's row layout, carried BY THE MODULE. Found live 2026-08-06 (R,
// in-headset): the sp-row/sp-label classes came from the lab's panel
// framework and were never extracted with this file, so nothing upstream
// defined them — the mic meter (an inline span with flex:1) collapsed to a
// 2px vertical line, which is just its threshold marker with zero meter
// behind it. A module's markup and its layout must travel together.
// ONE GRID, not two shapes. R: "have we formatted the stuff in the audio panel
// in a dumb way?" — yes, and the specific dumbness is that check-rows read
// [box][label] while slider-rows read [label][control], so the two kinds shared
// no vertical edge and the eye had nothing to track down the panel. Labels also
// ran 11 to 32 characters against a 64px min-width that fit none of them.
//
// Now every row is the same two columns: a fixed label column, then the control.
// A checkbox sits in the control column like any other control, so ticks, bars
// and sliders all begin at the same x. Values right-align in a third column so
// they form a readable stack instead of drifting with label length.
const SP_CSS = `
.sp-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; min-height: 20px; }
.sp-label { opacity: .75; width: 132px; flex: 0 0 132px; text-align: right;
  line-height: 1.25; }
.sp-ctl { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.sp-val { flex: 0 0 40px; text-align: right; opacity: .6; font-variant-numeric: tabular-nums; }
.sp-note { opacity: .5; font-size: 11px; }
/* A group heading, for the two places a row needs a parent rather than a peer. */
.sp-head { opacity: .5; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
  margin: 12px 0 2px 142px; }
`;
function ensureCss() {
  if (document.getElementById('sp-audio-css')) return;
  const st = document.createElement('style');
  st.id = 'sp-audio-css';
  st.textContent = SP_CSS;
  document.head.appendChild(st);
}

const ROWS = [
  ['voices', 'voices', 'other people speaking, and agent speech'],
  ['world', 'world', 'ambience and place-sound — the 🎧 toggle never touches this'],
  ['tts', 'text-to-speech', 'synthetic narration only'],
];

function slider(cat, label, hint, value) {
  const row = document.createElement('div');
  row.className = 'sp-row';
  row.innerHTML =
    `<span class="sp-label" title="${hint}">${label}</span>` +
    `<span class="sp-ctl">` +
    `<input type="range" min="0" max="1" step="0.05" value="${value}" data-cat="${cat}" style="flex:1">` +
    `</span>` +
    `<span class="sp-val" data-out="${cat}">${Math.round(value * 100)}%</span>`;
  const input = row.querySelector('input');
  const out = row.querySelector('[data-out]');
  input.oninput = () => {
    const v = setVolume(cat, input.value);
    out.textContent = `${Math.round(v * 100)}%`;
  };
  return row;
}

function checkRow(label, hint, checked, onChange) {
  const row = document.createElement('div');
  // Every checkbox row is addressable by its label, so state changes can tick
  // the box in place instead of rebuilding the panel (see syncToggles). Tagging
  // here rather than at each call site means a new row cannot forget to do it —
  // and a row that forgot would go silently STALE, which is worse than the
  // rebuild flicker this replaced.
  row.dataset.row = label;
  row.className = 'sp-row';
  // LABEL FIRST, like every other row. The checkbox lives in the control column
  // so it aligns with the sliders and the meter rather than starting its own
  // margin. Whole row is a <label>, so the text is a click target too — a 12px
  // box is a small thing to hit, and in VR it is a laser-pointer coin toss.
  row.innerHTML =
    `<label class="sp-label" title="${hint}">${label}</label>` +
    `<span class="sp-ctl"><input type="checkbox" ${checked ? 'checked' : ''} title="${hint}"></span>`;
  row.querySelector('input').onchange = (e) => onChange(e.target.checked);
  row.querySelector('label').onclick = () => {
    const box = row.querySelector('input');
    box.checked = !box.checked;
    onChange(box.checked);
  };
  return row;
}


// The TTS dropdown that used to live here is gone — see ttsrow.js. Removed as
// dead code once ttsSection() replaced it: 670 lines still defined and never
// called reads as a second code path, and this panel has been bitten all day by
// exactly that (two writers on one element, two gates, two track references).

// mic sensitivity: a slider over a LIVE level bar, so you can see where your
// voice lands versus your keyboard before choosing the floor (R, 17:19 —
// typing sounds were pinging agents' ears). The bar animates only while the
// section is open and stops the moment its row leaves the DOM.
function micFloorRow() {
  const row = document.createElement('div');
  row.className = 'sp-row';
  // The hint has to name all THREE marks, because they are three different facts
  // and R reasonably asked what the green one was. It also no longer says "pings
  // nearby agents": this gated only the 🎙 icon when that was written, and it
  // now decides what the room actually hears.
  const hint = 'how much louder than your room a sound must be before anyone hears it. '
    + 'The bar is your live mic level and turns blue while you are actually being sent. '
    + '0% sends everything above the room noise; 100% sends nothing.';
  // Full-scale = the right edge of the meter. 0.2 SATURATED on ordinary speech
  // (normal talking is ~0.2-0.4 RMS), so the bar pinned at 100% and the marker
  // could be pushed off the end — part of why R read the slider as doing
  // nothing: "even someone talking in another room here is hitting 100% from
  // time to time." Both the level and the threshold are drawn against this, so
  // it has to span the loud end too.
  const FS = 0.6;
  row.innerHTML =
    `<span class="sp-label" title="${hint}">mic sensitivity</span>` +
    `<span class="sp-ctl"><span data-meter title="${hint}" style="flex:1;min-width:60px;position:relative;height:14px;` +
    `background:#000;border-radius:2px;overflow:hidden;cursor:ew-resize">` +
    // Born GREY, the same colour beat() paints when the gate is shut. It used to
      // be green — a colour nothing ever repainted, so it existed only until the
      // first animation frame and meant nothing (R, 2026-08-09: "what does the
      // green bar mean now?"). A colour that appears for one frame and never
      // returns is worse than no colour.
      `<span data-lvl style="position:absolute;left:0;top:0;height:100%;width:0;background:#6b5420"></span>` +
      // ONE MARK. R: "why an amber and a white bar? Why not just one? VRChat only
      // has one and no one seems to get confused about this." She is right, and
      // checking BasisVR settled it — their threshold slider is buried under an
      // ADVANCED group, behind a gate that is OFF by default and an "auto" mode
      // that is ON when you do enable it. Neither shipping product shows a user
      // the gate's internals.
      //
      // I was drawing a second mark because the live threshold moves with the
      // room and I found that interesting. That is a fact about my
      // implementation, not something anyone needs while setting a slider — and
      // it cost a colour, a legend, and this conversation. The bar going blue
      // already says "you are being heard", which is the only feedback the
      // setting needs.
      // 🔴 The handle needs a dark outline or it DISAPPEARS at the one moment it
      // matters. White on bright gold is 1.4:1 contrast — and the bar goes
      // bright exactly when it crosses the handle, so without this the marker
      // vanishes precisely as you are watching whether you crossed it. The
      // shadow costs nothing on the dark side (white on dark gold is 7.2:1).
      `<span data-handle style="position:absolute;top:0;height:100%;width:2px;background:#fff;` +
      `box-shadow:0 0 0 1px rgba(0,0,0,.55)" title="drag to set sensitivity"></span>` +
      // 🔴 CLOSE THE METER. I dropped this tag when removing the amber mark, so
      // the readout became a child of the meter — inside a position:relative box
      // it stopped sitting after the bar, which is why R asked why I had moved
      // it. I had not; I had broken the markup.
      `</span></span>` +
      `<span class="sp-val" data-out>${Math.round((micFloor() / 0.2) * 100)}%</span>`;
  const meter = row.querySelector('[data-meter]');
  const out = row.querySelector('[data-out]');
  const lvl = row.querySelector('[data-lvl]');
  const handle = row.querySelector('[data-handle]');
  const paintThr = () => {
    // The handle is painted by beat() from the live threshold — see there. It
    // must not be painted here too: two writers on one element is how the marker
    // and the colour drifted apart before.
    // 🔴 PERCENT, not a multiplier. R: "I'm not sure I agree with changing it
    // away from a percentage. 0% means it picks up everything, 100% means it
    // technically picks up nothing." She is right — a percentage of the
    // control's own range is the thing the user is setting and the thing they
    // can see themselves moving. "2.6×" was me leaking the implementation into
    // the label; how many times the room noise it takes is MY business.
    out.textContent = `${Math.round((micFloor() / 0.2) * 100)}%`;
  };
  paintThr();
  const setFromX = (ev) => {
    const r = meter.getBoundingClientRect();
    // 🔴 DRAG SPANS THE FULL WIDTH, independent of the meter's scale. This used
    // to map x through FS — fine while the marker's position and the stored
    // value shared a coordinate system, but the gate is relative now and FS had
    // to grow to stop the bar saturating. Coupling them would squeeze the whole
    // adjustable range into the left third of the bar. The pointer picks a
    // FRACTION of the control; what that fraction means is the gate's business.
    // The pointer fraction IS the threshold's position on the meter, because
    // the meter is linear in dB and so is the stored value. 1:1, no conversion,
    // nothing to drift.
    setMicFloor(((ev.clientX - r.left) / r.width) * 0.2);
    paintThr();
  };
  meter.onpointerdown = (ev) => { meter.setPointerCapture(ev.pointerId); setFromX(ev); };
  meter.onpointermove = (ev) => { if (meter.hasPointerCapture?.(ev.pointerId)) setFromX(ev); };
  let _shown = 0;
  const beat = () => {
    if (!row.isConnected) return;
    // 🔴 DRAW THE THRESHOLD THE GATE ACTUALLY USES. The marker sat at
    // micFloor/FS — a FIXED position — while the gate had moved to noise × k, so
    // the line and the truth coincided only by accident. R, 2026-08-09:
    // "adjusting the mic sensitivity isn't working? Seems like it's always cut
    // off at the 20% default." The slider WAS working; the picture was lying
    // about where the line was. micGateInfo() evaluates the same expression the
    // gate does, so the marker now moves when you drag the slider AND when the
    // room gets louder — the adaptive half was previously invisible.
    const g = micGateInfo();
    const level = g.level;
    // BOTH POSITIONS FROM ONE FUNCTION. meterPos() maps an amplitude to the
    // same -60..0 dB span for the bar and the marker, so they are in one
    // coordinate system by construction — the thing that was wrong every
    // previous time. The marker no longer moves on its own; the level moves
    // past it, which is what makes it draggable.
    // SMOOTHED FOR THE EYE ONLY. R: "average out the waveform bar a little so it's
    // not jumping around so much." An RMS read every frame is genuinely that jumpy
    // — speech is spiky at 60Hz. Classic meter ballistics: fast attack so a peak is
    // not hidden, slow release so the bar settles instead of strobing.
    //
    // 🔴 The GATE still sees the raw level. Smoothing the input to a threshold
    // comparison would round off exactly the transients the gate exists to catch,
    // and would put the bar and the gate back in disagreement — this control's
    // entire history. Display smoothing, nothing else.
    const target = meterPos(level);
    _shown += (target - _shown) * (target > _shown ? 0.5 : 0.12);
    lvl.style.width = `${_shown * 100}%`;
    handle.style.left = `calc(${meterPos(gateThreshold()) * 100}% - 1px)`;
    // 🔴 COLOUR BY GATE STATE. My dB rewrite replaced the block this line lived in
    // and silently dropped it, so the bar sat dark gold forever — R: "right now
    // it's all dark gold". g.speaking includes the 700ms hang-time, so the bar
    // stays bright through a pause mid-sentence, which is exactly when audio is
    // still going out.
    lvl.style.background = g.speaking ? '#ffd66b' : '#6b5420';
    requestAnimationFrame(beat);
  };
  requestAnimationFrame(beat);
  return row;
}

let _body = null;

function syncToggles() {
  if (!_body) return false;
  let found = 0;
  const set = (row, val) => {
    const box = _body.querySelector(`[data-row="${row}"] input[type="checkbox"]`);
    if (box) { box.checked = val; found++; }
  };
  set('microphone', micOn());
  set('hear voices', receivingVoice() && !isHushed());
  set('connect to their audio', receivingVoice());
  return found > 0;          // false = rows not built yet; caller falls back
}

function paint(body) {
  _body = body ?? _body;
  if (!_body) return;
  const body_ = _body;
  body_.innerHTML = '';
  const p = audioPrefs();
  // MIC FIRST. It is the control people reach for most, and it was sitting
  // below three volume sliders (R, 2026-08-09). Putting it beside 'hear
  // voices' also pairs the two switches that decide whether you are in the
  // conversation at all — one for each direction — before any question of
  // how loud things are.

  // The structural act, deliberately last: hush is a gain, this is the
  // connection. Unticking negotiates no inbound media at all — the only row
  // here that is a guarantee rather than a preference. The wording leads with
  // what you GET (no connection, no cost) rather than with the mechanism,
  // because "refuse inbound audio" reads as a second mute to anyone who has
  // not thought about the wire. (Field note: a reader asked what it affords
  // over muting — if the label has to be explained, the label is wrong.)
  // THE MIC, as a checkbox — the same pairing 'connect to other people's audio'
  // has with the 🎧 icon (R, 2026-08-09). One truth, two surfaces: the HUD icon
  // and this row both call toggleMic(), and the 'voice' bus event repaints
  // whichever one you did not touch.
  body_.append(checkRow('microphone',
    'on: your microphone is open and the noise gate decides when you are audible. '
    + 'Off: the device is released and the recording indicator goes away. '
    + 'Same control as the 🎙 button in the dock.',
    micOn(), async () => {
      // toggleMic owns BOTH directions and the permission prompt. The panel must
      // not reimplement either, or the two surfaces drift — which is the bug
      // class this whole panel keeps hitting.
      try { await toggleMic(CONFIG.name); } catch (e) { report('mic toggle', e); }
        // NO paint() HERE. toggleMic emits 'voice', and the subscription below
        // ticks this box in place. Calling paint() as well was why the mic still
        // tore the panel down while 'hear voices' — which only sets state and
        // lets the event do the syncing — behaved correctly (R, 2026-08-09).
        // Two surfaces, ONE mechanism: state change → event → sync.
    }));
    // Sensitivity belongs WITH the mic, not four rows below it (R, 2026-08-09).
    // It is the microphone's one setting, and it is only meaningful while the
    // mic is on — reading it next to the switch it modifies is the difference
    // between a setting and a stray slider.
  body_.append(micFloorRow());

  // 'hear voices' is what you HEAR — the same bit the 🎧 glyph toggles, so
  // the two controls can never disagree about the world you are in. (Field
  // report 12:43: toggling the headphone left this row stale, which is two
  // controls showing two different states while looking like one.) Ticking
  // it from a fully-revoked state grants consent as well, exactly like the
  // glyph, so the box is never a dead end.
  body_.append(checkRow('hear voices',
    'peers and agent speech — the 🎧 glyph is this same switch',
    receivingVoice() && !isHushed(), (on) => {
      if (on) { if (!receivingVoice()) setReceiveVoice(true); setHush(false); }
      else setHush(true);
    }));
  for (const [cat, label, hint] of ROWS) {
    body_.append(slider(cat, label, hint,
      cat === 'world' ? p.volWorld : cat === 'tts' ? p.volTts : p.volVoices));
  }
  // The TTS section is a LIST now, not a dropdown — see ttsrow.js / voicelist.js.
  // It repaints itself and asks us to repaint siblings when it changes state.
  {
    const host = document.createElement('div');
    body_.appendChild(host);
    // 🔴 THE TTS SECTION MUST NOT REBUILD THE PANEL (R, 2026-08-09: "the
    // checkbox also makes the panel tear down and rebuild"). It used to pass
    // paint(), which does body.innerHTML = '' — so every TTS state change wiped
    // the sliders, the scrollbar and the mic rows. Nothing outside this section
    // depends on which voice is selected; the only cross-row effect is the mic
    // toggle, which has its own event. Sync the toggles in place instead.
    ttsSection(host, () => { if (!syncToggles()) paint(); });
  }
  body_.append(checkRow('speech-to-text',
    'sends your mic audio to your browser vendor’s cloud to transcribe',
    sttConsented(), (on) => setSttConsent(on)));

  // SELF-MONITOR. R: "can you feed my own audio lane back to me for this test so
  // I can hear myself?" Taps AFTER the gate, so it is exactly what the room
  // receives — a monitor on the raw mic would sound perfect while everyone else
  // heard silence, which is the confusion it exists to resolve. Off by default
  // and deliberately not persisted: it howls on speakers.
  body_.append(checkRow('hear myself',
    'plays your own gated microphone back to you, exactly as others receive it — '
    + 'so you can tell whether the noise gate clips your first word or cuts you '
    + 'off early. USE HEADPHONES: on speakers this will feed back.',
    selfMonitoring(), (on) => {
      // Refusing silently would read as a broken checkbox, and it can only fail
      // for one reason: there is no mic to monitor.
      if (on && !setSelfMonitor(true)) flashHint('turn the microphone on first');
      else if (!on) setSelfMonitor(false);
        // This row CAN refuse (no mic to monitor), so the box must go back —
        // but revert the box, do not rebuild the panel. Same mechanism as every
        // other toggle; only the trigger differs.
        const box = _body?.querySelector('[data-row="hear myself"] input[type="checkbox"]');
        if (box) box.checked = selfMonitoring();
    }));

    body_.append(checkRow('connect to their audio',
    'on: your machine holds a live connection to each speaker nearby. ' +
    'Off: nothing is sent to you at all — saves bandwidth and CPU in busy ' +
    'rooms, and strangers cannot see your IP address. Muting only turns the ' +
    'volume down; this unplugs the wire.',
      receivingVoice(), (on) => { setReceiveVoice(on); if (on) setHush(false); }));
}

export function initAudioPanel() {
  ensureCss();
  makeSection('🔊 audio', (body) => paint(body), { id: 'audio' });
  // either control moving repaints the other's row — one truth, two surfaces
  // 🔴 SYNCING A CHECKBOX DOES NOT NEED THE PANEL REBUILT.
  //
  // These three events used to call paint(), which does `body.innerHTML = ''`
  // and remakes EVERY row. R, 2026-08-09: toggling the mic "jostles everything
  // in the panel for a tick and the scroll bar and some options disappear" —
  // same for hear-voices. They did: the scrollbar, the voice list, and anything
  // mid-interaction were destroyed and rebuilt on every toggle.
  //
  // Tick the boxes in place instead. Each row is synced from its OWN source of
  // truth rather than from the event payload, because 'hear voices' is a DERIVED
  // state (receiving && !hushed) that either event can change — patching only
  // the row whose event fired would be the asymmetric repair this codebase keeps
  // producing.
  const sync = () => { if (!syncToggles()) paint(); };
  bus.on('voice', sync);
  bus.on('audio:hush', sync);
  bus.on('audio:receive', sync);
}
