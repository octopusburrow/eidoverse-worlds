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
import { audioPrefs, setVolume, receivingVoice, setReceiveVoice,
  sttConsented, setSttConsent, isHushed, setHush,
  micFloor, setMicFloor } from './voiceconsent.js';
import { ttsAvailable, ttsVoiceName, isTtsEnabled, setTtsEnabled, setTtsSource } from './voicesource.js';
import { localVoiceSupported } from './localvoice.js';
import { report, CONFIG } from './core.js';
import { setEndpointVoice } from './browservoice.js';
import { micAnalyserLevel, micOn, toggleMic, setSelfMonitor, selfMonitoring } from './voice.js';
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
  const why = ttsAvailable() ? hint
    : 'tick to speak with the voice shown — it loads on first use';
  row.innerHTML =
    // Never rendered disabled. The dropdown shows what WOULD go live; ticking
    // this is how you make it live, and loads it if needed. A switch that is
    // dead until you have already configured the thing it switches on is a
    // switch you cannot use for its one purpose.
    `<input type="checkbox" ${isTtsEnabled() ? 'checked' : ''} title="${why}">` +
    // The label tracks whether the voice is LIVE, not merely whether one could
    // exist: full white when the checkbox is on and a synthesizer is present,
    // dimmed otherwise. R asked for exactly this — a row that is off should read
    // as off at a glance, without parsing the checkbox (2026-08-09).
    `<span class="sp-label" title="${why}" style="opacity:${ttsAvailable() && isTtsEnabled() ? '1' : '.45'}">` +
    // "TTS endpoint" named ONE of the two things this row accepts, so it was
    // wrong the moment a model file became the other. The label says what the
    // row DOES; the rows below say what it takes.
    `${agentVoice ? 'TTS voice' : 'text-to-speech'}</span>` +
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
            // NO "microphone" entry. R, 2026-08-09: "I'm not thrilled with
            // 'microphone' being an option in this list at all... just showing
            // default/last selected and making the checkbox always check-able
            // might be best of all — it's showing you what WOULD go live IF the
            // checkbox were ticked."
            //
            // She is describing a cleaner division than the one I built: the
            // DROPDOWN answers "which voice", the CHECKBOX answers "on or off".
            // Putting "microphone (no synthesis)" in the list made the dropdown
            // a second off-switch, so two controls fought over one job and the
            // panel could show a selection that meant "no selection".
            //
            // The list now holds only real voices. Off is the checkbox, and
            // only the checkbox.
            // NO DOWNLOADED DEFAULT, deliberately (R, 2026-08-09: "I'm leery of
            // download sizes... if we can't make it work I'd say just don't offer
            // anything by default and rely on the user to BYOV"). The smallest
            // English Piper voice is 63 MB — there is no small one to bundle, and
            // a default is by definition what happens to someone who did not
            // choose. Charging an unchosen 63 MB from a third party's CDN is the
            // wrong cost in the wrong place, and a dependency we cannot promise.
            //
            // AND NO BROWSER SPEECH EITHER. I first kept it with an honest
            // label ("only you hear this"); R killed that too, and she is right:
            // "it would be very easy to logically infer with this set-up that if
            // you can hear your own voice then other people can too." That is
            // how sidetone works EVERYWHERE else — hearing yourself is the
            // universal confirmation that you are transmitting. A warning label
            // loses to a mechanism that contradicts it, and the failure is
            // silent and social: you talk, nobody answers, and nothing tells you
            // why. speechSynthesis cannot reach the mic lane (🔴 note in
            // voicesource.js: OS-level synthesis, no samples in the page), so it
            // can never be a voice for a shared world. It belongs to a different
            // problem — "read the text back to me" — which wants a screen reader,
            // not this row.
            //
            // The resting state is therefore an HONEST EMPTY: no voice until you
            // choose one. Nothing to un-learn later.
            `<option value="__none">no voice — pick one below</option>` +
            `<option value="__loading">loading voices…</option>` +
            `<option value="__file">voice file on this computer…</option>` +
            `<option value="__custom">custom endpoint…</option></select>` +
            // ADD / REMOVE, beside the list they act on (R, 2026-08-09: "an
            // add/remove pair of buttons lined up with the drop-down"). "+" is
            // the same file picker the "voice file on this computer…" entry
            // opened — a verb belongs on a button, not hidden as a fake item in
            // a list of nouns. "−" forgets the selected voice, and is disabled
            // for anything not removable (browser speech, the catalog) so it can
            // never look like it will delete something it cannot.
            `<button class="sp-add" title="add a voice file from this computer" ` +
            `style="background:#222;color:inherit;border:1px solid #444;padding:0 6px;cursor:pointer">+</button>` +
            `<button class="sp-del" title="forget the selected voice" disabled ` +
            `style="background:#222;color:inherit;border:1px solid #444;padding:0 6px;cursor:pointer">−</button>` +
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
  // No "needs an endpoint" here any more. It dated from when an address was the
  // only way to get a voice, and it fires whenever nothing is LOADED — which,
  // now that voices load lazily on tick, is the ordinary startup state. R saw it
  // sitting under a perfectly valid selected voice (2026-08-09), which reads as
  // "this voice is broken" when the truth is "not loaded yet, tick to load".
  if (!ttsAvailable() && !agentVoice) note.textContent = '';
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
    opt.style.fontStyle = '';
    opt.style.opacity = '';
    // Mark it removable so the "−" button can tell a voice YOU added from the
    // built-ins it must never offer to delete.
    opt.dataset.remembered = '1';
    sel.value = '__loaded';
  };

  // THE SELECTION MUST APPEAR THE INSTANT IT IS MADE. Loading a local voice can
  // take tens of seconds, and until it finished the dropdown still showed the
  // PREVIOUS entry — so the one control you just used looked like it had ignored
  // you (R, 2026-08-09: "it should put the voice name into the dropdown right
  // away to show that the selection is being processed"). Same option element as
  // adoptLoadedFile, so there is no second code path to drift: italic + dimmed
  // says "this is what you picked, and it is not usable yet", and the seconds
  // counter beside it says the wait is progressing rather than hung.
  const pendingLoadedFile = (name) => {
    const sel = row.querySelector('select');
    if (!sel) return;
    let opt = sel.querySelector('option[value="__loaded"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = '__loaded';
      sel.insertBefore(opt, sel.firstChild);
    }
    opt.textContent = `${name} — loading…`;
    opt.title = `${name} (loading — not usable yet)`;
    opt.style.fontStyle = 'italic';
    opt.style.opacity = '0.6';
    sel.value = '__loaded';
  };

  // ONE place that turns a dropdown key into a live voice, so the checkbox and
  // the <select> cannot drift into disagreeing about what "selected" means.
  // Returns whether a voice is now installed.
  async function activate(key) {
    const note2 = row.querySelector('.sp-note');
    if (key === '__loaded') return ttsAvailable();
    // THE EMPTY STATE IS A REAL STATE. No voice installed, nothing pretending to
    // be one. Clearing the source matters: switching from a loaded voice back to
    // "none" must actually remove it, or the row would keep speaking in a voice
    // the dropdown says is not selected.
    if (key === '__none') {
      setTtsSource(null);
      if (note2) note2.textContent = 'pick a voice file or an endpoint';
      return false;
    }
    // A REMEMBERED FILE VOICE. Reached only from the tick or a click — both
    // user gestures — which is what lets requestPermission() actually ask
    // instead of throwing. If the grant is refused the honest outcome is
    // false: the caller unticks and the voice stays visibly not-live.
    if (key.startsWith('file:')) {
      try {
        const { listVoices, openVoice } = await import('./voicestore.js');
        const entry = (await listVoices()).find((v) => v.id === key);
        if (!entry) { if (note2) note2.textContent = 'that voice is no longer remembered'; return false; }
        const files = await openVoice(entry, { allowPrompt: true });
        const { loadFromFiles } = await import('./voiceengines.js');
        await import('./engines.js');
        const { label } = await loadFromFiles(files, (p) => { if (note2) note2.textContent = p.text || p.phase || 'loading…'; });
        if (note2) note2.textContent = 'ready';
        localStorage.setItem('eido.localVoice', key);
        return !!label || ttsAvailable();
      } catch (e) {
        if (note2) note2.textContent = String(e?.message || e).slice(0, 90);
        report('remembered voice', e);
        return false;
      }
    }
    // A CATALOG VOICE. This used to return false — so ticking the box with a
    // catalog voice showing could never work, independently of the restore bug.
    // Two ways to reach the same dead end is why R saw it as "can't check it
    // on": the selection was real, and nothing here would honour it.
    try {
      const { useLocalVoice } = await import('./localvoice.js');
      await useLocalVoice(key, (p) => {
        if (!note2) return;
        note2.textContent = p.phase === 'download'
          ? `downloading${p.pct != null ? ` ${p.pct}%` : `… ${p.mb} MB`}`
          : p.phase === 'runtime' ? 'loading runtime…' : '';
      });
      localStorage.setItem('eido.localVoice', key);
      if (note2) note2.textContent = 'ready';
      return true;
    } catch (e) {
      if (note2) note2.textContent = 'failed — see console';
      report('local voice', e);
      return false;
    }
  }

  // The dropdown⇄address-box swap, with a door in BOTH directions. The back
  // door is a real control (a "←" button), not a keyboard escape or a reload,
  // because a way back you cannot see is not a way back.
  function showEndpointBox(on) {
    const sel2 = row.querySelector('select');
    const box2 = row.querySelector('input[type=text]');
    if (!sel2 || !box2) return;
    box2.style.display = on ? '' : 'none';
    sel2.style.display = on ? 'none' : '';
    let back = row.querySelector('.sp-back');
    if (on && !back) {
      back = document.createElement('button');
      back.className = 'sp-back';
      back.textContent = '←';
      back.title = 'back to the voice list';
      back.style.cssText = 'background:#222;color:inherit;border:1px solid #444;'
        + 'padding:1px 6px;cursor:pointer;flex-shrink:0';
      // Read the stored choice rather than closing over `saved`, which is
      // declared in a later block — the closure would throw at click time
      // (TDZ), turning the way back into a second dead end.
      back.onclick = () => {
        showEndpointBox(false);
        sel2.value = localStorage.getItem('eido.localVoice')
          || localStorage.getItem('eido.ttsChoice') || '__none';
      };
      box2.after(back);
    }
    if (back) back.style.display = on ? '' : 'none';
  }

  // Progress with a REAL bar where a real fraction exists, and a moving elapsed
  // count where none does. R: "It says 'preparing voice' for a looooong time and
  // there's no loading bar" (2026-08-09). I had argued a fake percentage would
  // be a bar that lies — true, but a frozen label for 30+ seconds is its own
  // lie: it cannot be told apart from a hang. So: the copy phase knows its
  // fraction (we are moving the bytes) and gets a bar; the compile phase cannot
  // know one and gets seconds counting up, which is honest AND visibly alive.
  const showProgress = (p) => {
    const note2 = row.querySelector('.sp-note');
    if (!note2) return;
    note2.textContent = p.text || p.phase || 'loading…';
    let bar = row.querySelector('.sp-bar');
    if (p.pct == null) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('span');
      bar.className = 'sp-bar';
      bar.style.cssText = 'display:inline-block;width:52px;height:4px;background:#333;'
        + 'border-radius:2px;overflow:hidden;margin-left:6px;vertical-align:middle';
      bar.innerHTML = '<span style="display:block;height:100%;width:0;background:#6cf"></span>';
      note2.after(bar);
    }
    const fill = bar.firstChild;
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, p.pct))}%`;
  };

  const lab = row.querySelector('.sp-label');
  const paintLive = () => {
    if (lab) lab.style.opacity = (ttsAvailable() && isTtsEnabled()) ? '1' : '.45';
  };
  // ALWAYS TICKABLE. The dropdown shows what WOULD go live; the checkbox makes
  // it live. Previously the box was disabled until a voice happened to be
  // loaded, which meant the control that turns speech on was dead exactly when
  // you wanted to turn speech on — you had to know to configure something else
  // first. Now ticking it loads the selected voice if it is not loaded yet.
  box.disabled = false;
  box.onchange = async (e) => {
    if (!e.target.checked) { setTtsEnabled(false); paintLive(); return; }
    if (!ttsAvailable()) {
      // Nothing loaded yet: ticking IS the request to load what is shown.
      const sel = row.querySelector('select');
      const key = sel ? sel.value : '__none';
      const ok = await activate(key);
      if (!ok) {
        // Un-ticking itself with no explanation is how a control reads as broken.
        // With no voice chosen there is nothing to switch on, and the note has to
        // say so rather than leaving a box that refuses to stay ticked for
        // invisible reasons.
        e.target.checked = false;
        const note2 = row.querySelector('.sp-note');
        if (note2 && key === '__none') note2.textContent = 'choose a voice first';
        paintLive();
        return;
      }
    }
    e.target.checked = setTtsEnabled(true);
    paintLive();
  };

  // ── the voice dropdown ────────────────────────────────────────────────────
  const sel = row.querySelector('select');
  if (sel) {
    // "default/last selected" — what the dropdown shows when you arrive. A
    // catalog voice we downloaded before is still there; otherwise the empty
    // state, which always exists.
    //
    // MIGRATION: '__default' was browser speech, which no longer exists as an
    // option. A stored value naming a removed option would restore to nothing
    // and silently fall through to the <select>'s first entry — so map it to the
    // empty state explicitly instead of letting the browser guess.
    const rawSaved = localStorage.getItem('eido.localVoice')
      || localStorage.getItem('eido.ttsChoice');
    const saved = (!rawSaved || rawSaved === '__default') ? '__none' : rawSaved;
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
        // Restoring the SELECTION is not restoring the VOICE. This line used to
        // be the whole restore: the dropdown showed "alba", nothing was loaded,
        // and ticking the box found no source — so a valid-looking choice could
        // not be switched on until you selected away and back, which is the only
        // thing that fired onchange (R, 2026-08-09).
        //
        // Deliberately still LAZY: eagerly compiling a 63 MB graph on every page
        // load would trade this bug for a slow start on a voice you may not use.
        // The tick is what loads it. What was missing is that the tick had no
        // way to know which voice was showing — now it reads the dropdown, so
        // display and action finally refer to the same thing.
        // REMEMBERED FILE VOICES rejoin the list here, before the selection is
        // restored — otherwise `saved` names an option that does not exist yet
        // and the <select> silently falls back to its first entry.
        //
        // 🔴 The handle survives; the PERMISSION usually does not. So the entry
        // is listed but marked, and loading waits for the tick — a user gesture,
        // the only context in which requestPermission() may ask. Listing it
        // greyed is honest: we know which file you chose, and we may still have
        // to ask before reading it.
        try {
          const { listVoices, voiceReadable, canRemember } = await import('./voicestore.js');
          if (canRemember()) {
            for (const v of await listVoices()) {
              const state = await voiceReadable(v);
              if (state === 'denied' || state === 'gone') continue;   // dead weight
              const o = document.createElement('option');
              o.value = v.id;
              o.dataset.remembered = '1';
              o.dataset.voiceId = v.id;
              o.textContent = state === 'granted' ? v.name : `${v.name} (click to allow)`;
              o.title = state === 'granted'
                ? `${v.name} — on this computer`
                : `${v.name} — remembered, but this browser must ask before reading it again`;
              sel.insertBefore(o, custom);
            }
          }
        } catch (e) { console.warn('[voice] could not list remembered voices:', e); }
        if (saved) { sel.value = saved; if (!sel.value) sel.value = '__none'; }
      } catch (e) {
        sel.querySelector('option[value="__loading"]')?.remove();
        note.textContent = 'voice list unavailable';
        report('voice catalog', e);
      }
    })();

    // "+" is the SAME path as choosing "voice file on this computer…", not a
    // parallel implementation of it: set the value and fire the one handler, so
    // the two entry points can never drift into behaving differently.
    const addBtn = row.querySelector('.sp-add');
    const delBtn = row.querySelector('.sp-del');
    if (addBtn) addBtn.onclick = () => { sel.value = '__file'; sel.onchange(); };

    // Only a REMEMBERED voice can be forgotten. Browser speech is built in and
    // catalog voices are just names we can fetch again — offering to delete
    // either would be a button that lies about what it does. The one currently
    // loaded is removable too: forgetting is about the saved list, not about
    // what is playing right now.
    const refreshDel = () => {
      if (!delBtn) return;
      const opt = sel.selectedOptions?.[0];
      const removable = !!opt?.dataset?.remembered || sel.value === '__loaded';
      delBtn.disabled = !removable;
      delBtn.style.opacity = removable ? '1' : '.4';
      delBtn.style.cursor = removable ? 'pointer' : 'default';
      delBtn.title = removable ? 'forget the selected voice'
        : 'only voices you added from this computer can be forgotten';
    };
    if (delBtn) delBtn.onclick = async () => {
      const opt = sel.selectedOptions?.[0];
      if (!opt) return;
      const id = opt.dataset?.voiceId;
      if (id) {
        const { forgetVoice } = await import('./voicestore.js');
        await forgetVoice(id);
      }
      opt.remove();
      // Fall back to the built-in rather than to whatever happens to be first:
      // a removal should land somewhere predictable and always-present.
      sel.value = '__none';
      localStorage.setItem('eido.ttsChoice', '__none');
      localStorage.removeItem('eido.localVoice');
      note.textContent = 'forgotten';
      refreshDel();
    };

    sel.onchange = async () => {
      const key = sel.value;
      refreshDel();
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
            // Name it in the dropdown BEFORE the slow part, using the .onnx if
            // one is in the batch — that is the file a person thinks of as "the
            // voice"; the .json is its config.
            const shown = (picked.find((f) => /\.onnx$/i.test(f.name)) || picked[0])?.name;
            if (shown) pendingLoadedFile(shown.replace(/\.onnx$/i, ''));
            sel.disabled = true; note.textContent = 'loading…';
            try {
              const { loadFromFiles, matchEngine } = await import('./voiceengines.js');
              await import('./engines.js');   // registers whatever is available
              // A selection an engine ALMOST recognises (a lone .onnx) is the
              // common near-miss: offer a second dialog for the rest instead of
              // rejecting. Which files are missing is the engine's business, not
              // the panel's — we just ask for more and re-match.
              if (!matchEngine(picked) || picked.length === 1) {
                // A SECOND DIALOG MUST SAY WHAT IT WANTS. This used to open bare
                // — no description, no filter — so it read as the same dialog
                // appearing again for no reason (R, 2026-08-09). A file picker
                // with no title is indistinguishable from a bug. Name the file
                // already in hand and the extension still missing, and filter to
                // that extension so the right file is the obvious one to click.
                const have = picked[0]?.name || 'a file';
                const wantExt = /\.onnx$/i.test(have) ? '.onnx.json'
                  : /\.json$/i.test(have) ? '.onnx' : null;
                note.textContent = wantExt
                  ? `${have} selected — now pick the matching ${wantExt}`
                  : `${have} selected — pick the rest of the voice`;
                const more = await window.showOpenFilePicker({
                  multiple: true,
                  // The description is the only text a native dialog reliably
                  // shows us, so it carries the instruction.
                  types: wantExt
                    ? [{ description: `Matching ${wantExt} for ${have}`,
                         accept: wantExt === '.onnx'
                           ? { 'application/octet-stream': ['.onnx'] }
                           : { 'application/json': ['.json'] } }]
                    : undefined,
                }).catch(() => null);
                if (more?.length) picked = [...picked, ...await Promise.all(more.map((h) => h.getFile()))];
              }
              const { label } = await loadFromFiles(picked, (p) => {
                showProgress(p);
              });
              showProgress({ text: 'ready' });   // pct absent → removes the bar
              note.title = label;
              box.disabled = false; box.checked = setTtsEnabled(true);
              adoptLoadedFile(label);
              // REMEMBER IT. `handles` are FileSystemFileHandles and survive a
              // reload; the File objects above do not. Best-effort: a voice
              // that loaded must not fail because we could not write a note
              // about it (private browsing refuses IndexedDB outright).
              try {
                const { rememberVoice, canRemember } = await import('./voicestore.js');
                if (canRemember()) {
                  const vid = `file:${shown || label}`;
                  if (await rememberVoice(vid, shown || label, handles)) {
                    const o = sel.querySelector('option[value="__loaded"]');
                    if (o) o.dataset.voiceId = vid;
                    localStorage.setItem('eido.localVoice', vid);
                  }
                }
              } catch (e) { console.warn('[voice] not remembered:', e); }
              paintLive();
            } catch (e) {
              // loadFromFiles throws a message naming the known formats — show
              // it, since "failed" tells the user nothing actionable.
              note.textContent = String(e?.message || e).slice(0, 120);
              // Drop the pending entry — see rearm(): a name left in the list
              // after a failed load claims a working voice that is not there.
              const stale2 = sel.querySelector('option[value="__loaded"]');
              if (stale2 && !ttsAvailable()) stale2.remove();
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
          // A FAILED LOAD MUST NOT LEAVE ITS NAME IN THE LIST. The pending entry
          // says "you picked this"; if the load then failed, leaving it behind
          // claims a voice is selected that cannot speak — the dropdown would be
          // lying about state, which is the bug class that has cost the most
          // time here. Drop it unless a real voice is actually loaded.
          const stale = sel.querySelector('option[value="__loaded"]');
          if (stale && !ttsAvailable()) stale.remove();
          sel.value = saved || '';        // release __file so it is selectable again
          fp.value = '';                  // and let the same file re-trigger change
        };
        fp.onchange = async () => {
          const files = [...(fp.files || [])];
          if (!files.length) return rearm('');
          // Same instant feedback as the showOpenFilePicker path. This branch is
          // Firefox/Safari, where we CANNOT open a second dialog — so the picker
          // is multi-select (`multiple` on the input) and a short selection has
          // to come back as a clear message rather than a second popup.
          const shown0 = (files.find((f) => /\.onnx$/i.test(f.name)) || files[0])?.name;
          if (shown0) pendingLoadedFile(shown0.replace(/\.onnx$/i, ''));
          sel.disabled = true; note.textContent = 'loading…';
          try {
            const { loadFromFiles } = await import('./voiceengines.js');
            await import('./engines.js');
            // Which files an engine needs — and why — is the ENGINE's knowledge.
            // The panel used to hardcode "onnx plus its json", which is true of
            // Piper and false of the next one. Now a bad selection comes back as
            // that engine's own message.
            const { label } = await loadFromFiles(files, (p) => {
              showProgress(p);
            });
            showProgress({ text: 'ready' });   // pct absent → removes the bar
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
        // 🔴 EVERY SWAP NEEDS ITS WAY BACK. Hiding the dropdown to reveal the
        // address box was one-way: no control on screen could bring the list
        // back, so choosing "custom endpoint…" cost you every other voice until
        // a hard reload (R, 2026-08-09 — the THIRD one-way exit in this panel
        // today; the rule is the fix, not the individual door).
        if (box2) { showEndpointBox(true); box2.focus(); note.textContent = ''; }
        else note.textContent = 'no address box in this build';
        return;
      }
      // Selecting a voice never turns speech OFF and never disables the box —
      // that is the checkbox's job alone. Picking browser speech while the row
      // is live swaps the voice under it; picking it while off just changes
      // what WOULD go live.
      if (!key || key === '__none') {
        localStorage.setItem('eido.ttsChoice', '__none');
        const ok = await activate('__none');
        if (ok && isTtsEnabled()) box.checked = setTtsEnabled(true);
        paintLive();
        return;
      }
      // ONE loading path. This block used to duplicate activate()'s catalog
      // logic, which is how the two could disagree about whether a voice was
      // loaded — the dropdown's copy ran on change, activate()'s did not exist,
      // and the checkbox believed activate(). Same function now, both callers.
      sel.disabled = true;
      try {
        const ok = await activate(key);
        // Choosing a voice means wanting it: switch on. But only claim "on" if
        // the source actually installed — setTtsEnabled returns the truth.
        if (ok) box.checked = setTtsEnabled(true);
        paintLive();
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
        // Clearing the address turns the voice off but leaves the box usable —
        // a control that turns speech on must never be dead when you want it.
        setTtsSource(null); box.checked = setTtsEnabled(false); note.textContent = ''; paintLive();
        return;
      }
      url.disabled = true; note.textContent = 'connecting…';
      const ok = await setEndpointVoice(v);
      url.disabled = false;
      // Say WHICH way it failed: an unreachable endpoint and a reachable one
      // that returns nothing are different problems with different fixes.
      if (!ok) { note.textContent = 'unreachable'; box.checked = setTtsEnabled(false); paintLive(); return; }
      localStorage.setItem('eido.ttsEndpoint', v);
      note.textContent = '';
      box.checked = setTtsEnabled(true);   // naming a voice means wanting it
      // A working endpoint becomes an entry in the list and hands the list
      // back, so "custom endpoint" is a round trip rather than a place you end
      // up. Same treatment as a loaded file: what you configured is now a thing
      // you can see and re-select.
      adoptLoadedFile(ttsVoiceName() || `endpoint: ${v}`);
      showEndpointBox(false);
      paintLive();
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
      paint();
    }));

  // SELF-MONITOR. R: "can you feed my own audio lane back to me for this test so
  // I can hear myself?" Taps AFTER the gate, so it is exactly what the room
  // receives — a monitor on the raw mic would sound perfect while everyone else
  // heard silence, which is the confusion it exists to resolve. Off by default
  // and deliberately not persisted: it howls on speakers.
  body_.append(checkRow('hear myself (test)',
    'plays your own gated microphone back to you, exactly as others receive it — '
    + 'so you can tell whether the noise gate clips your first word or cuts you '
    + 'off early. USE HEADPHONES: on speakers this will feed back.',
    selfMonitoring(), (on) => {
      // Refusing silently would read as a broken checkbox, and it can only fail
      // for one reason: there is no mic to monitor.
      if (on && !setSelfMonitor(true)) flashHint('turn the microphone on first');
      else if (!on) setSelfMonitor(false);
      paint();
    }));

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
  // mic button and mic checkbox are one truth on two surfaces
  bus.on('voice', () => paint());
}
