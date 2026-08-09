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
// Where the current call wants stdout/stderr to go. See the print note below.
let _sink = null, _errSink = null;
let _building = null;

/** Build (once) and return the phonemize module. */
async function phonModule(wasmPaths) {
  if (_mod) return _mod;
  // Single-flight: two utterances in the same tick must not each start a
  // 30-second build. The second awaits the first.
  if (_building) return _building;
  _building = (async () => {
    // 🔴 IMPORT THE CHUNK BY URL. Two dead ends first, both checked rather than
    // assumed: a bare specifier for a hashed dist file is unresolvable in a
    // browser (the library reaches it by a path relative to ITS OWN file), and
    // the package root does NOT re-export createPiperPhonemize — its exports are
    // HF_BASE, ONNX_BASE, PATH_MAP, TtsSession, WASM_BASE, download, flush,
    // predict, remove, stored, voices.
    //
    // But the chunk is a real ES module sitting in node_modules, which we serve.
    // new URL(..., import.meta.url) is exactly how engine-piper.js already
    // resolves the ORT and phonemizer wasm, so this is the established route out
    // of the same problem.
    //
    // The hash is pinned to the installed version. If a bump changes it this
    // throws a clear error rather than silently falling back to the 30s path —
    // which is the failure mode worth protecting: silently slow reads as fine.
    const chunkUrl = new URL(
      '../node_modules/@mintplex-labs/piper-tts-web/dist/piper-o91UDS6e.js',
      import.meta.url,
    ).href;
    const { createPiperPhonemize } = await import(/* @vite-ignore */ chunkUrl);
    if (typeof createPiperPhonemize !== 'function') {
      throw new Error(`piper: no createPiperPhonemize at ${chunkUrl} — did the package version change?`);
    }
    const m = await createPiperPhonemize({
      // 🔴 EMSCRIPTEN CAPTURES print ONCE, AT CONSTRUCTION:
      //     var out = Module["print"] || console.log.bind(console);   (line 292)
      // I had assumed it was read per call and reassigned m.print in phonemize(),
      // which did nothing — the ids went to console.log and we reported
      // "phonemizer produced no ids" (R, 2026-08-09). So install a PERMANENT
      // print here that forwards to a swappable sink, and let each call set the
      // sink instead of the handler.
      print: (data) => { _sink?.(data); },
      printErr: (msg) => { _errSink?.(msg); },
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
    _sink = (data) => {
      try { out = JSON.parse(data).phoneme_ids; } catch { /* not our line */ }
    };
    _errSink = (msg) => reject(new Error(String(msg)));
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
    _sink = null; _errSink = null;
    if (out) resolve(out);
    else reject(new Error('phonemizer produced no ids'));
  });
}

/** Build the module NOW, before anyone speaks.
 *
 *  🔴 Measured 2026-08-09: the build is ~27s. Caching it fixed the per-word cost
 *  (30s → 4ms) but left the whole 27s sitting in front of the FIRST utterance —
 *  lazily, at the worst possible moment, with the user waiting on a word they
 *  already typed. It depends on nothing but the wasm paths, so it can happen
 *  during voice loading instead, under the progress the user is already
 *  watching. Same total work, moved to where it is expected. */
export async function warmPhonemizer(wasmPaths, onProgress = () => {}) {
  if (_mod) return true;
  const t0 = performance.now();
  const tick = setInterval(() => {
    onProgress({ phase: 'phonemizer',
      text: `preparing speech — ${Math.round((performance.now() - t0) / 1000)}s` });
  }, 1000);
  try { await phonModule(wasmPaths); return true; }
  catch (e) { console.warn('[voice] phonemizer warm-up failed:', e); return false; }
  finally { clearInterval(tick); }
}

/** Whether a module is already built — for logging honestly about first-call cost. */
export const phonReady = () => !!_mod;
