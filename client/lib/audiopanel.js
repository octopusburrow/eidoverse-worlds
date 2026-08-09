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

import { makeSection } from './ui.js';
import { audioPrefs, setVolume, receivingVoice, setReceiveVoice,
  sttConsented, setSttConsent, isHushed, setHush,
  micFloor, setMicFloor } from './voiceconsent.js';
import { ttsAvailable, ttsVoiceName, isTtsEnabled, setTtsEnabled, setTtsSource } from './voicesource.js';
import { localVoiceSupported } from './localvoice.js';
import { report } from './core.js';
import { setEndpointVoice } from './browservoice.js';
import { micAnalyserLevel } from './voice.js';
import { bus } from './core.js';

// The panel's row layout, carried BY THE MODULE. Found live 2026-08-06 (R,
// in-headset): the sp-row/sp-label classes came from the lab's panel
// framework and were never extracted with this file, so nothing upstream
// defined them — the mic meter (an inline span with flex:1) collapsed to a
// 2px vertical line, which is just its threshold marker with zero meter
// behind it. A module's markup and its layout must travel together.
const SP_CSS = `
.sp-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.sp-label { opacity: 0.75; min-width: 64px; flex-shrink: 0; }
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
    `<input type="range" min="0" max="1" step="0.05" value="${value}" data-cat="${cat}" style="flex:1">` +
    `<span class="sp-info" data-out="${cat}" style="min-width:34px;text-align:right">${Math.round(value * 100)}%</span>`;
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
  row.className = 'sp-row';
  row.innerHTML =
    `<input type="checkbox" ${checked ? 'checked' : ''} title="${hint}">` +
    `<span class="sp-label" title="${hint}">${label}</span>`;
  row.querySelector('input').onchange = (e) => onChange(e.target.checked);
  return row;
}


// Voice source. Blank for a human — their microphone is whatever the OS and
// browser already chose, and this panel does not second-guess it. An agent
// registers a synthesizer (setTtsSource) and its name appears here, so the
// question "how is that one speaking?" always has a visible answer instead of
// being a property of some other process nobody can see. Off by default:
// speaking is opt-in exactly like a mic (R, 2026-08-08).
function ttsRow() {
  const row = document.createElement('div');
  row.className = 'sp-row';
  const agentVoice = ttsAvailable() && !ttsVoiceName().startsWith('endpoint:');
  // THE FIELD WANTS AN ADDRESS, NOT A FILE (R, 2026-08-08: "it looks like some
  // kind of ip string instead of a file path...?"). It is a running synthesizer
  // to ASK for audio — a browser cannot load a .onnx voice model directly, so
  // Piper runs as a service and we talk to it. The old label said "TTS voice",
  // which next to a text box reads as "name your voice"; it now says what it
  // takes. And the checkbox was `disabled` until a source existed, so ticking
  // it before connecting did nothing with only a tooltip to explain — the
  // second half of the same confusion.
  const hint = agentVoice
    ? `synthesized voice: ${ttsVoiceName()} — set by this body's harness`
    : 'address of a synthesizer you run yourself (ws:// or http://) — not a file. ' +
      'Nothing is downloaded from this server and nothing is uploaded from your machine.';
  // A DISABLED CONTROL MUST OFFER A WAY FORWARD. Without a synthesizer the box
  // is dead and the only explanation was a tooltip, so it reads as broken
  // rather than as "not yet configured" (R, 2026-08-08: "the tick box doesn't
  // work"). The note beside it now says what to do, in the field's own terms.
  const why = ttsAvailable() ? hint : 'no synthesizer yet — put its address in the box →';
  row.innerHTML =
    `<input type="checkbox" ${isTtsEnabled() ? 'checked' : ''} ${ttsAvailable() ? '' : 'disabled'} title="${why}">` +
    // The label tracks whether the voice is LIVE, not merely whether one could
    // exist: full white when the checkbox is on and a synthesizer is present,
    // dimmed otherwise. R asked for exactly this — a row that is off should read
    // as off at a glance, without parsing the checkbox (2026-08-09).
    `<span class="sp-label" title="${why}" style="opacity:${ttsAvailable() && isTtsEnabled() ? '1' : '.45'}">` +
    `${agentVoice ? 'TTS voice' : 'TTS endpoint'}</span>` +
    (agentVoice
      ? `<span style="flex:1;opacity:.6">${ttsVoiceName()}</span>`
      // A DROPDOWN, NOT AN ADDRESS (R, 2026-08-09: "seeing a port is going to be
      // pretty confusing for a user"). She was right — I shipped my own dev
      // plumbing as the interface because I already had a synth on a port.
      // Picking a voice downloads the model to YOUR browser once, from Hugging
      // Face directly, and inference runs on YOUR machine; the server never
      // touches a 60 MB file. The address box survives as the advanced option
      // for a custom voice (ours is not in the public catalog) or a GPU synth.
      : (localVoiceSupported()
          // The address box is emitted ALONGSIDE the select, hidden, not instead
          // of it. It used to be an either/or, so on a machine with local voices
          // the input did not exist in the DOM at all — picking "custom
          // endpoint…" printed "use ?tts=PORT for now" and there was nowhere to
          // type. A dropdown option that names a capability has to reveal the
          // control for it (R, 2026-08-09: "the dropdown says 'custom endpoint'
          // but I can't point it anywhere").
          ? `<select style="flex:1;min-width:0;background:#222;color:inherit;border:1px solid #444;padding:1px 4px">` +
            // Name what you GET, not what is missing. "microphone (no
            // synthesized voice)" described an absence, so the row read as
            // broken-until-configured. This is a valid, working choice — your
            // own voice — and saying so removes the pull to tick a box that has
            // nothing behind it. (setTtsEnabled() already refuses to enable
            // without a source, so the invalid state R worried about cannot be
            // reached; this fixes the part that was actually reachable: the
            // impression that no valid option was selected.)
            `<option value="">your microphone (no synthesis)</option>` +
            `<option value="__loading">loading voices…</option>` +
            `<option value="__file">voice file on this computer…</option>` +
            `<option value="__custom">custom endpoint…</option></select>` +
            `<input type="file" accept=".onnx,.json" multiple style="display:none">` +
            `<input type="text" placeholder="ws://127.0.0.1:8927 or http://host/tts" ` +
            `style="display:none;flex:1;min-width:0;background:#222;color:inherit;border:1px solid #444;padding:1px 4px" ` +
            `title="${hint}">`
          : `<input type="text" placeholder="ws://127.0.0.1:8927  (blank = microphone)" ` +
            `style="flex:1;min-width:0;background:#222;color:inherit;border:1px solid #444;padding:1px 4px" ` +
            `title="${hint}">`)) +
    `<span class="sp-note" style="opacity:.5;font-size:11px"></span>`;

  const box = row.querySelector('input[type=checkbox]');
  const note = row.querySelector('.sp-note');
  if (!ttsAvailable() && !agentVoice) note.textContent = 'needs an endpoint';
  // One place that decides how "live" looks, so the label can never disagree
  // with the checkbox — every path that changes voice state calls this.
  // A loaded file becomes a REAL option, selected — so the dropdown shows the
  // voice you are using instead of sitting on the verb you used to get it
  // ("voice file on this computer…", which reads as if nothing happened).
  // R asked for this directly (2026-08-09). Reusing one slot rather than
  // appending means picking a second file replaces the first, which matches
  // what actually happened: there is only ever one loaded voice.
  const adoptLoadedFile = (label) => {
    const sel = row.querySelector('select');
    if (!sel) return;
    let opt = sel.querySelector('option[value="__loaded"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = '__loaded';
      sel.insertBefore(opt, sel.firstChild);
    }
    opt.textContent = label;
    opt.title = label;
    sel.value = '__loaded';
  };

  const lab = row.querySelector('.sp-label');
  const paintLive = () => {
    if (lab) lab.style.opacity = (ttsAvailable() && isTtsEnabled()) ? '1' : '.45';
  };
  box.onchange = (e) => { e.target.checked = setTtsEnabled(e.target.checked); paintLive(); };

  // ── the voice dropdown ────────────────────────────────────────────────────
  const sel = row.querySelector('select');
  if (sel) {
    const saved = localStorage.getItem('eido.localVoice') || '';
    (async () => {
      try {
        const { suggestedVoices } = await import('./localvoice.js');
        const list = await suggestedVoices();
        sel.querySelector('option[value="__loading"]')?.remove();
        const custom = sel.querySelector('option[value="__custom"]');
        for (const v of list) {
          const o = document.createElement('option');
          o.value = v.key;
          // SAY THE SIZE. A silent 63 MB download reads as a hang.
          o.textContent = v.mb ? `${v.label} — ${v.mb} MB` : v.label;
          sel.insertBefore(o, custom);
        }
        if (saved) sel.value = saved;
      } catch (e) {
        sel.querySelector('option[value="__loading"]')?.remove();
        note.textContent = 'voice list unavailable';
        report('voice catalog', e);
      }
    })();

    sel.onchange = async () => {
      const key = sel.value;
      // Re-selecting the voice already loaded is a no-op, not a reload: the
      // model is in memory and re-running the 63 MB compile would look like a
      // hang for no reason.
      if (key === '__loaded') return;
      if (key === '__file') {
        // R, 2026-08-09: "it would be best if the endpoints are file names on a
        // person's own machine and the engine sets up all the endpoint stuff for
        // them automatically." Right — a voice you already have on disk should
        // not require standing up an HTTP server to reach it. Pick the .onnx
        // (and its .onnx.json) and we register it in-process; nothing listens on
        // a port, nothing leaves the machine.
        const fp = row.querySelector('input[type=file]');
        if (!fp) { note.textContent = 'no file picker in this build'; return; }

        // Best path where it exists: showOpenFilePicker lets us ASK for the pair
        // in one dialog and, crucially, re-open on demand — so "retry" is a real
        // affordance rather than a reload. Falls back to <input type=file> on
        // Firefox/Safari, which cannot do this.
        if (window.showOpenFilePicker) {
          try {
            const handles = await window.showOpenFilePicker({
              multiple: true,
              types: [{ description: 'Piper voice (.onnx + .onnx.json)',
                        accept: { 'application/octet-stream': ['.onnx'], 'application/json': ['.json'] } }],
            });
            let picked = await Promise.all(handles.map((h) => h.getFile()));
            sel.disabled = true; note.textContent = 'loading…';
            try {
              const { loadFromFiles, matchEngine } = await import('./voiceengines.js');
              await import('./engines.js');   // registers whatever is available
              // A selection an engine ALMOST recognises (a lone .onnx) is the
              // common near-miss: offer a second dialog for the rest instead of
              // rejecting. Which files are missing is the engine's business, not
              // the panel's — we just ask for more and re-match.
              if (!matchEngine(picked) || picked.length === 1) {
                const more = await window.showOpenFilePicker({ multiple: true })
                  .catch(() => null);
                if (more?.length) picked = [...picked, ...await Promise.all(more.map((h) => h.getFile()))];
              }
              const { label } = await loadFromFiles(picked, (p) => {
                note.textContent = p.text || p.phase || 'loading…';
              });
              note.textContent = 'ready';
              note.title = label;
              box.disabled = false; box.checked = setTtsEnabled(true);
              adoptLoadedFile(label);
              paintLive();
            } catch (e) {
              // loadFromFiles throws a message naming the known formats — show
              // it, since "failed" tells the user nothing actionable.
              note.textContent = String(e?.message || e).slice(0, 120);
              sel.value = saved || '';
              report('local voice file', e);
            } finally { sel.disabled = false; }
          } catch {
            // User dismissed the dialog — not an error, but the dropdown still
            // has to come back or they cannot reopen it.
            note.textContent = ''; sel.value = saved || '';
          }
          return;
        }
        // 🔴 EVERY EXIT FROM HERE MUST LEAVE THE CONTROL USABLE. Selecting an
        // option that then refuses is a dead end: <select> fires no change event
        // when you pick the value it already holds, so R picked one file, got
        // "also pick the .json", and could not retry (2026-08-09). Any early
        // return has to hand the dropdown back.
        const rearm = (msg) => {
          note.textContent = msg;
          sel.value = saved || '';        // release __file so it is selectable again
          fp.value = '';                  // and let the same file re-trigger change
        };
        fp.onchange = async () => {
          const files = [...(fp.files || [])];
          if (!files.length) return rearm('');
          sel.disabled = true; note.textContent = 'loading…';
          try {
            const { loadFromFiles } = await import('./voiceengines.js');
            await import('./engines.js');
            // Which files an engine needs — and why — is the ENGINE's knowledge.
            // The panel used to hardcode "onnx plus its json", which is true of
            // Piper and false of the next one. Now a bad selection comes back as
            // that engine's own message.
            const { label } = await loadFromFiles(files, (p) => {
              note.textContent = p.text || p.phase || 'loading…';
            });
            note.textContent = 'ready';
            note.title = label;
            box.disabled = false; box.checked = setTtsEnabled(true);
            adoptLoadedFile(label);
            paintLive();
          } catch (e) {
            // Same rule: a failure must leave the picker usable, not stranded on
            // an option that refuses to re-fire.
            rearm(String(e?.message || e).slice(0, 120));
            report('local voice file', e);
          } finally { sel.disabled = false; }
        };
        fp.click();
        return;
      }
      if (key === '__custom') {
        // Reveal the address box and hand it the caret, rather than telling the
        // user to go relaunch with a URL parameter.
        const box2 = row.querySelector('input[type=text]');
        if (box2) { box2.style.display = ''; sel.style.display = 'none'; box2.focus(); note.textContent = ''; }
        else note.textContent = 'no address box in this build';
        return;
      }
      if (!key) {
        setTtsSource(null); localStorage.removeItem('eido.localVoice');
        box.checked = false; box.disabled = true; note.textContent = '';
        return;
      }
      sel.disabled = true;
      try {
        const { useLocalVoice } = await import('./localvoice.js');
        await useLocalVoice(key, (p) => {
          note.textContent = p.phase === 'download'
            ? `downloading${p.pct != null ? ` ${p.pct}%` : `… ${p.mb} MB`}`
            : p.phase === 'runtime' ? 'loading runtime…' : '';
        });
        localStorage.setItem('eido.localVoice', key);
        note.textContent = 'ready';
        box.disabled = false;
        box.checked = setTtsEnabled(true);   // choosing a voice means wanting it
      } catch (e) {
        note.textContent = 'failed — see console';
        report('local voice', e);
      } finally { sel.disabled = false; }
    };
  }

  const url = row.querySelector('input[type=text]');
  if (url) {
    url.value = localStorage.getItem('eido.ttsEndpoint') || '';
    const apply = async () => {
      const v = url.value.trim();
      if (!v) {
        setTtsSource(null); localStorage.removeItem('eido.ttsEndpoint');
        box.checked = false; box.disabled = true; note.textContent = '';
        return;
      }
      url.disabled = true; note.textContent = 'connecting…';
      const ok = await setEndpointVoice(v);
      url.disabled = false;
      // Say WHICH way it failed: an unreachable endpoint and a reachable one
      // that returns nothing are different problems with different fixes.
      if (!ok) { note.textContent = 'unreachable'; box.disabled = true; box.checked = false; return; }
      localStorage.setItem('eido.ttsEndpoint', v);
      note.textContent = '';
      box.disabled = false;
      box.checked = setTtsEnabled(true);   // naming a voice means wanting it
    };
    url.onchange = apply;
    if (url.value) apply();                // restore across reloads
  }
  return row;
}

// mic sensitivity: a slider over a LIVE level bar, so you can see where your
// voice lands versus your keyboard before choosing the floor (R, 17:19 —
// typing sounds were pinging agents' ears). The bar animates only while the
// section is open and stops the moment its row leaves the DOM.
function micFloorRow() {
  const row = document.createElement('div');
  row.className = 'sp-row';
  const hint = 'mic level below the marker is treated as room noise, not speech — ' +
    'raise it if typing pings nearby agents; the bar shows your live mic level';
  const FS = 0.2;  // full-scale mic level = right edge of the meter
  row.innerHTML =
    `<span class="sp-label" title="${hint}">mic sensitivity</span>` +
    `<span data-meter title="${hint}" style="flex:1;min-width:60px;position:relative;height:14px;` +
    `background:#000;border-radius:2px;overflow:hidden;cursor:ew-resize">` +
    `<span data-lvl style="position:absolute;left:0;top:0;height:100%;width:0;background:#3c5"></span>` +
    `<span data-thr style="position:absolute;top:0;height:100%;width:2px;background:#9f9;opacity:.9"></span>` +
    `</span>` +
    `<span data-out style="min-width:34px;text-align:right">${Math.round(micFloor() * 500)}%</span>`;
  const meter = row.querySelector('[data-meter]');
  const out = row.querySelector('[data-out]');
  const lvl = row.querySelector('[data-lvl]');
  const thr = row.querySelector('[data-thr]');
  const paintThr = () => {
    thr.style.left = `calc(${Math.min(100, (micFloor() / FS) * 100)}% - 1px)`;
    out.textContent = `${Math.round(micFloor() * 500)}%`;
  };
  paintThr();
  const setFromX = (ev) => {
    const r = meter.getBoundingClientRect();
    setMicFloor(((ev.clientX - r.left) / r.width) * FS);
    paintThr();
  };
  meter.onpointerdown = (ev) => { meter.setPointerCapture(ev.pointerId); setFromX(ev); };
  meter.onpointermove = (ev) => { if (meter.hasPointerCapture?.(ev.pointerId)) setFromX(ev); };
  const beat = () => {
    if (!row.isConnected) return;
    const level = micAnalyserLevel();
    lvl.style.width = `${Math.min(100, (level / FS) * 100)}%`;
    requestAnimationFrame(beat);
  };
  requestAnimationFrame(beat);
  return row;
}

let _body = null;
function paint(body) {
  _body = body ?? _body;
  if (!_body) return;
  const body_ = _body;
  body_.innerHTML = '';
  const p = audioPrefs();
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
  body_.append(micFloorRow());
  body_.append(ttsRow());
  body_.append(checkRow('speech-to-text',
    'sends your mic audio to your browser vendor’s cloud to transcribe',
    sttConsented(), (on) => setSttConsent(on)));
  // The structural act, deliberately last: hush is a gain, this is the
  // connection. Unticking negotiates no inbound media at all — the only row
  // here that is a guarantee rather than a preference. The wording leads with
  // what you GET (no connection, no cost) rather than with the mechanism,
  // because "refuse inbound audio" reads as a second mute to anyone who has
  // not thought about the wire. (Field note: a reader asked what it affords
  // over muting — if the label has to be explained, the label is wrong.)
  body_.append(checkRow('connect to other people’s audio',
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
  bus.on('audio:hush', () => paint());
  bus.on('audio:receive', () => paint());
}
