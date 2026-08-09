// piperphon — build the phonemizer ONCE, not once per word.
//
// 🔴 MEASURED, 2026-08-09: 30,359ms. Thirty seconds, per utterance, to rebuild
// an emscripten module that wraps a 17 MB espeak-ng data file — and
// @mintplex-labs/piper-tts-web's predict() calls that factory on EVERY call.
// Inference itself is nearly free; this was the whole delay R heard as "waaaay
// delayed (10s+) and distorted".
//
// She spotted it this morning and I dismissed it, twice, on bad measurements:
// first timing the factory in BUN against local files (34-52ms, meaningless for
// a browser), then blaming single-threaded ONNX (real, but worth almost nothing
// here — cross-origin isolation landed and the delay did not move). The lesson
// is not "the phonemizer is slow". It is: I measured the neighbour of the thing
// I suspected, twice, and concluded about the thing.
//
// Why the library cannot be configured out of this: the factory lives in a
// WeakMap private field, so it cannot be wrapped, and predict() hardcodes the
// build. So we do the same call ourselves and keep the module. Verified
// re-entrant in Bun this morning: first callMain 44ms, second 4ms.

let _mod = null;
let _building = null;

/** Build (once) and return the phonemize module. */
async function phonModule(wasmPaths) {
  if (_mod) return _mod;
  // Single-flight: two utterances in the same tick must not each start a
  // 30-second build. The second awaits the first.
  if (_building) return _building;
  _building = (async () => {
    const { createPiperPhonemize } = await import(
      /* @vite-ignore */ '@mintplex-labs/piper-tts-web/dist/piper-o91UDS6e.js'
    );
    const m = await createPiperPhonemize({
      // print/printErr are REBOUND per call in phonemize() below — emscripten
      // reads them off the module object at call time, so one module can serve
      // many calls with different result handlers.
      print: () => {},
      printErr: () => {},
      locateFile: (url) => {
        if (url.endsWith('.wasm')) return wasmPaths.piperWasm;
        if (url.endsWith('.data')) return wasmPaths.piperData;
        return url;
      },
    });
    _mod = m;
    _building = null;
    return m;
  })();
  return _building;
}

/** text → phoneme ids, reusing the module across calls.
 *  `voice` is the espeak voice from the model config (e.g. "en-us"). */
export async function phonemize(text, voice, wasmPaths) {
  const m = await phonModule(wasmPaths);
  return new Promise((resolve, reject) => {
    let out = null;
    m.print = (data) => {
      try { out = JSON.parse(data).phoneme_ids; } catch { /* not our line */ }
    };
    m.printErr = (msg) => reject(new Error(String(msg)));
    try {
      m.callMain([
        '-l', voice,
        '--input', JSON.stringify([{ text: String(text).trim() }]),
        '--espeak_data', '/espeak-ng-data',
      ]);
    } catch (e) {
      // Emscripten signals main()'s return by THROWING its exit status. A
      // number (or an object carrying `status`) is a normal exit, not a
      // failure — treating it as one would make every successful call an error.
      if (typeof e !== 'number' && e?.status === undefined) return reject(e);
    }
    if (out) resolve(out);
    else reject(new Error('phonemizer produced no ids'));
  });
}

/** Whether a module is already built — for logging honestly about first-call cost. */
export const phonReady = () => !!_mod;
