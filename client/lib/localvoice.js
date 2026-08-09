// localvoice — PIPER IN THE USER'S OWN BROWSER, on the human speech lane.
//
// R's constraint (2026-08-09): "a local model that the user does their own
// inference for and runs on the same speech lane that human mic voice does" —
// and explicitly NOT the server serving the models, because they are ~60 MB.
//
// So: the browser fetches the voice DIRECTLY FROM HUGGING FACE (verified
// 2026-08-09: the CDN answers `access-control-allow-origin: *`, 63 MB, 200
// after a 302), runs the inference itself, and hands PCM to the same
// setTtsSource() seam the ws:// endpoint uses. Our server never sees a model,
// and the output rides voiceSource() — the identical path a microphone takes,
// so distance, the category sliders and consent all apply by construction
// rather than by a parallel implementation that has to remember to.
//
// The endpoint box does not go away; it becomes the ADVANCED option, for a
// voice the public catalog does not have (hesperus-clockwork is ours) or a
// GPU-backed synth. Dropdown for everyone else.
//
// Caching: the runtime stores the model in the Origin Private File System, so
// the ~60 MB download happens once per voice per browser and survives reloads.

import { setTtsSource } from './voicesource.js';
import { report } from './core.js';
import { decodeWavToPcm } from './wavpcm.js';

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

// THE CATALOG IS THE PACKAGE'S, NOT MINE. It ships voices() — 118 voices
// across 37 languages with real file sizes and metadata — so hardcoding five
// would be inventing a worse version of data that already exists. I wrote that
// hardcoded list first; checking the .d.ts is what replaced it.
//
// We still curate the DEFAULT view: a raw 118-entry dropdown is its own
// usability failure. English first, one quality tier per voice, everything
// else behind "show all".
const PREFERRED = [
  'en_US-amy-medium', 'en_US-lessac-medium', 'en_US-ryan-high',
  'en_GB-alba-medium', 'en_GB-northern_english_male-medium', 'en_US-hfc_female-medium',
];

let catalog = null;

/** The full catalog, fetched once. Each entry carries its own byte sizes, so
 *  the UI can say "63 MB" honestly instead of guessing. */
export async function listVoices() {
  if (catalog) return catalog;
  const mod = await runtime();
  const all = await mod.voices();
  catalog = all.map((v) => {
    const onnx = Object.entries(v.files).find(([k]) => k.endsWith('.onnx'));
    return {
      key: v.key,
      label: `${v.name} (${v.language.country_english}, ${v.quality})`,
      lang: v.language.code,
      mb: onnx ? Math.round(onnx[1].size_bytes / 1e6) : null,
      preferred: PREFERRED.includes(v.key),
    };
  });
  return catalog;
}

/** What the dropdown shows by default: the curated few, biggest-signal first. */
export const suggestedVoices = async () =>
  (await listVoices()).filter((v) => v.preferred);

let engine = null;      // the loaded runtime, once a voice is chosen
let loadedKey = null;

/** Lazily import the runtime. Nobody who never picks a local voice should pay
 *  for the bundle. @mintplex-labs/piper-tts-web is the MAINTAINED fork (1.0.4,
 *  Feb 2026); @diffusionstudio/vits-web — the name everyone cites — has not
 *  been touched since Sep 2024. Checked; do not trust the popular name. */
async function runtime() {
  if (!engine) engine = await import('@mintplex-labs/piper-tts-web');
  return engine;
}

/** Is a browser-side runtime even possible here? Needs WASM + (ideally) OPFS. */
export const localVoiceSupported = () => (
  typeof WebAssembly === 'object' &&
  typeof navigator !== 'undefined' &&
  !!navigator.storage?.getDirectory
);

/** Download progress is not a nicety at 63 MB — it is the difference between
 *  "broken" and "working, wait a moment". Callers pass a reporter. */
export async function useLocalVoice(voiceKey, onProgress = () => {}) {
  const v = (await listVoices()).find((x) => x.key === voiceKey);
  if (!v) throw new Error(`unknown voice: ${voiceKey}`);
  if (!localVoiceSupported()) throw new Error('this browser cannot run a local voice');

  onProgress({ phase: 'runtime' });
  await runtime();
  if (false) {
    // Imported lazily: nobody who never picks a local voice should pay for the
    // runtime bundle. @mintplex-labs/piper-tts-web is the maintained fork
    // (Feb 2026); @diffusionstudio/vits-web, the name everyone cites, has not
    // been touched since Sep 2024 — checked, do not trust the popular name.
  }

  if (loadedKey !== voiceKey) {
    onProgress({ phase: 'download', mb: v.mb });
    await engine.download(voiceKey, (p) => {
      if (p?.total) onProgress({ phase: 'download', mb: v.mb, pct: Math.round((p.loaded / p.total) * 100) });
    });
    loadedKey = voiceKey;
  }

  onProgress({ phase: 'ready' });
  // THE SEAM. Same shape the ws:// endpoint returns — {pcm: Int16Array,
  // sampleRate} — so everything downstream (the pacer, the generator, the
  // sender, distance, consent) is byte-identical whether the samples came from
  // a local model, a remote synth, or a microphone.
  setTtsSource(async (text) => {
    // predict() takes a CONFIG OBJECT and returns a Blob — checked against the
    // shipped .d.ts, not guessed. My first draft called it predict(text, id).
    const wav = await engine.predict({ text, voiceId: voiceKey });
    return decodeWavToPcm(await wav.arrayBuffer());
  }, `local: ${v.label}`);

  return true;
}
