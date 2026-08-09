/** Piper as a voice-engine plugin — the first user of the slot, and the proof
 *  it fits an engine that was NOT designed for it.
 *
 *  Everything piper-specific lives here: the two-file shape, the OPFS
 *  cache-seeding trick, PATH_MAP. voiceengines.js knows none of it, and neither
 *  does the panel.
 */
import { registerEngine } from './voiceengines.js';
import { setTtsSource } from './voicesource.js';
import { decodeWavToPcm } from './wavpcm.js';

let engine = null;
const runtime = async () => (engine ??= await import('@mintplex-labs/piper-tts-web'));

registerEngine({
  id: 'piper',
  label: 'Piper',
  accept: ['.onnx', '.json'],

  // OPFS is not optional: local files reach the runtime only through its cache.
  supported: () => typeof WebAssembly === 'object' && !!navigator.storage?.getDirectory,

  // Score, not boolean. A lone .onnx might belong to another ONNX engine, so
  // that scores 1; a matching .onnx + .onnx.json pair is unmistakably Piper and
  // scores 3. Whoever recognises MORE of the selection wins.
  match: (files) => {
    const onnx = files.find((f) => f.name.toLowerCase().endsWith('.onnx'));
    if (!onnx) return 0;
    const want = `${onnx.name.toLowerCase()}.json`;
    const paired = files.some((f) => f.name.toLowerCase() === want);
    if (paired) return 3;
    // A .json that looks like a piper config (phoneme_id_map) is also decisive,
    // even if its name does not follow the convention.
    return files.some((f) => f.name.toLowerCase().endsWith('.json')) ? 2 : 1;
  },

  async load(files) {
    const onnx = files.find((f) => f.name.toLowerCase().endsWith('.onnx'));
    const cfg = files.find((f) => f.name.toLowerCase().endsWith('.json'));
    if (!onnx) throw new Error('Piper needs the .onnx model file');
    // Say WHY, not just what: the config carries the phoneme→id map, the sample
    // rate and the espeak language — none of it recoverable from the model.
    if (!cfg) throw new Error(`Piper also needs ${onnx.name}.json — it holds the phoneme map and sample rate`);

    const e = await runtime();
    const base = onnx.name.replace(/\.onnx$/i, '');

    // The runtime has no seam for local model bytes: TtsSession always resolves
    // a voiceId through PATH_MAP and fetches HuggingFace. But getBlob() reads an
    // OPFS cache FIRST, keyed by basename. So seed the cache under the names it
    // will look for and it never touches the network. Its own cache, used the
    // way it already works — no fork, no patch.
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('piper', { create: true });
    for (const [name, file] of [[`${base}.onnx`, onnx], [`${base}.onnx.json`, cfg]]) {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      await w.write(await file.arrayBuffer());
      await w.close();
    }
    if (e.PATH_MAP && !e.PATH_MAP[base]) e.PATH_MAP[base] = `${base}.onnx`;

    let sr = null;
    try { sr = JSON.parse(await cfg.text())?.audio?.sample_rate ?? null; } catch { /* label only */ }

    const speak = async (text) => {
      const wav = await e.predict({ text, voiceId: base });
      return decodeWavToPcm(await wav.arrayBuffer());
    };
    const label = `Piper: ${base}${sr ? ` (${sr} Hz)` : ''}`;
    setTtsSource(speak, label);
    return { speak, label };
  },
});
