// ttsrow — the text-to-speech section, as a LIST of voices you have.
//
// Replaces a 670-line dropdown that had accumulated: a catalog we no longer
// ship, a "loading voices…" entry that was not a voice, a verb disguised as an
// option, a +/− pair whose "−" could not name its target, and browser speech,
// which cannot reach the mic lane at all and so was a permanent trap.
//
// The rule that killed all of it (R, 2026-08-09): a <select> is for choosing
// among options SOMEONE ELSE fixed. The moment the options are ones the user
// adds and removes, the list wants to be visible and the verb belongs on the
// row. See feedback_dropdown_vs_list.md.
//
// What remains is BYOV: a model file from your disk, or a speech server you run.
// Both transmit; nothing here is local-only, because a voice that only you can
// hear is indistinguishable from a working one until nobody answers.

import { renderVoiceList } from './voicelist.js';
import { ttsAvailable, ttsVoiceName, isTtsEnabled, setTtsEnabled, setTtsSource } from './voicesource.js';
import { setEndpointVoice } from './browservoice.js';
import { report } from './core.js';

// The id of whatever is currently installed, so the list can show a filled dot
// against it. Null when nothing is loaded — which is a real state, not an error.
let _selected = null;
let _busy = null;          // a phase string while loading, else null

/** Everything we know how to speak with: remembered files + this session's
 *  endpoints. Kept here rather than in the list so the list stays a renderer. */
async function collectVoices() {
  const out = [];
  try {
    const { listVoices, voiceReadable, canRemember } = await import('./voicestore.js');
    if (canRemember()) {
      for (const v of await listVoices()) {
        const state = await voiceReadable(v);
        if (state === 'denied' || state === 'gone') continue;
        out.push({
          id: v.id,
          name: v.name,
          dim: state !== 'granted',
          note: state === 'granted'
            ? `${v.name} — a model on this computer`
            : `${v.name} — remembered, but this browser must ask before reading it again`,
        });
      }
    }
  } catch (e) { console.warn('[voice] could not list remembered voices:', e); }
  for (const ep of endpoints()) {
    out.push({ id: `ep:${ep}`, name: ep, note: `speech server at ${ep}` });
  }
  return out;
}

// Endpoints live in localStorage as a list, not a single value: "the one
// endpoint" was a field you had to retype every time you wanted the other one.
const EP_KEY = 'eido.ttsEndpoints';
const endpoints = () => {
  try { return JSON.parse(localStorage.getItem(EP_KEY) || '[]'); } catch { return []; }
};
const saveEndpoints = (list) => {
  try { localStorage.setItem(EP_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* private mode */ }
};

/** Build (and rebuild) the section. `host` is the row container; `onPaint` lets
 *  the panel repaint sibling rows whose state we just changed. */
export function ttsSection(host, onPaint = () => {}) {
  const repaint = () => { build(); onPaint(); };

  async function pick(id) {
    if (id === _selected && ttsAvailable()) return;    // already live
    _busy = 'loading…'; build();
    try {
      if (id.startsWith('ep:')) {
        await setEndpointVoice(id.slice(3));
      } else {
        const { listVoices, openVoice } = await import('./voicestore.js');
        const entry = (await listVoices()).find((v) => v.id === id);
        if (!entry) throw new Error('that voice is no longer remembered');
        // allowPrompt: this runs from a click, which is the only context in
        // which requestPermission() may ask.
        const files = await openVoice(entry, { allowPrompt: true });
        const { loadFromFiles } = await import('./voiceengines.js');
        await import('./engines.js');
        await loadFromFiles(files, (p) => { _busy = p.text || p.phase || 'loading…'; build(); });
      }
      _selected = id;
      setTtsEnabled(true);
    } catch (e) {
      report('tts voice', e);
      _busy = String(e?.message || e).slice(0, 80);
      build();
      setTimeout(() => { _busy = null; repaint(); }, 2500);
      return;
    }
    _busy = null;
    repaint();
  }

  async function remove(id) {
    if (id.startsWith('ep:')) {
      saveEndpoints(endpoints().filter((e) => e !== id.slice(3)));
    } else {
      const { forgetVoice } = await import('./voicestore.js');
      await forgetVoice(id);
    }
    // Removing what is currently speaking also stops it — leaving a live voice
    // whose entry is gone would be state the UI cannot show.
    if (id === _selected) { setTtsSource(null); setTtsEnabled(false); _selected = null; }
    repaint();
  }

  async function addFile() {
    try {
      const { loadFromFiles, matchEngine } = await import('./voiceengines.js');
      await import('./engines.js');
      if (!window.showOpenFilePicker) {
        _busy = 'this browser cannot pick files here — use a speech server';
        build(); setTimeout(() => { _busy = null; repaint(); }, 3000);
        return;
      }
      let handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'Piper voice (.onnx + .onnx.json)',
                  accept: { 'application/octet-stream': ['.onnx'], 'application/json': ['.json'] } }],
      });
      let files = await Promise.all(handles.map((h) => h.getFile()));
      // A lone .onnx is the common near-miss. Ask for the rest, NAMING what is
      // missing — an unlabelled second dialog reads as a bug.
      if (!matchEngine(files) || files.length === 1) {
        const have = files[0]?.name || 'a file';
        const want = /\.onnx$/i.test(have) ? '.onnx.json' : '.onnx';
        _busy = `${have} selected — now pick the matching ${want}`;
        build();
        const more = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: `Matching ${want} for ${have}`,
                    accept: want === '.onnx' ? { 'application/octet-stream': ['.onnx'] }
                                             : { 'application/json': ['.json'] } }],
        }).catch(() => null);
        if (more?.length) {
          handles = [...handles, ...more];
          files = [...files, ...await Promise.all(more.map((h) => h.getFile()))];
        }
      }
      const shown = (files.find((f) => /\.onnx$/i.test(f.name)) || files[0])?.name || 'voice';
      const name = shown.replace(/\.onnx$/i, '');
      _busy = `loading ${name}…`; build();
      await loadFromFiles(files, (p) => { _busy = p.text || p.phase || `loading ${name}…`; build(); });

      const id = `file:${name}`;
      try {
        const { rememberVoice, canRemember } = await import('./voicestore.js');
        if (canRemember()) await rememberVoice(id, name, handles);
      } catch (e) { console.warn('[voice] not remembered:', e); }
      _selected = id;
      setTtsEnabled(true);
      _busy = null;
      repaint();
    } catch (e) {
      // An aborted picker is a choice, not an error.
      if (e?.name === 'AbortError') { _busy = null; build(); return; }
      report('add voice file', e);
      _busy = String(e?.message || e).slice(0, 80);
      build(); setTimeout(() => { _busy = null; repaint(); }, 3000);
    }
  }

  function addEndpoint() {
    const addr = prompt('Address of a speech server you are running:\n(ws://… or http://…)', 'ws://127.0.0.1:8927');
    if (!addr) return;
    const list = endpoints();
    if (!list.includes(addr)) { list.unshift(addr); saveEndpoints(list); }
    pick(`ep:${addr}`);
  }

  function build() {
    host.textContent = '';
    const head = document.createElement('div');
    head.className = 'sp-row';
    const live = ttsAvailable() && isTtsEnabled();
    // Same two columns as every other row: label, then control. The status note
    // rides in the control column beside the tick rather than starting a third
    // ragged column of its own.
    head.innerHTML =
      `<label class="sp-label" style="opacity:${live ? '1' : '.45'}">text-to-speech</label>` +
      `<span class="sp-ctl">` +
      `<input type="checkbox" ${isTtsEnabled() ? 'checked' : ''} ` +
      `title="speak with the voice marked below"${ttsAvailable() ? '' : ' disabled'}>` +
      `<span class="sp-note">` +
      `${_busy ? _busy : live ? ttsVoiceName() : ttsAvailable() ? 'ready' : 'add a voice below'}</span>` +
      `</span>`;
    head.querySelector('input').onchange = (e) => {
      setTtsEnabled(e.target.checked);
      repaint();
    };
    host.appendChild(head);

    const listHost = document.createElement('div');
    // Indent to the CONTROL column (label 104px + 10px gap), so the voices hang
    // under the checkbox that switches them on rather than floating mid-panel.
    listHost.style.cssText = 'margin:2px 0 8px 142px';
    host.appendChild(listHost);
    collectVoices().then((items) => {
      renderVoiceList(listHost, {
        items, selected: _selected, busy: _busy,
        on: { select: pick, remove, addFile, addEndpoint },
      });
    });
  }

  build();
  return host;
}
