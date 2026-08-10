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
let _phonCost = 0;   // measured once: see speak()
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

  async load(files, onProgress = () => {}) {
    const onnx = files.find((f) => f.name.toLowerCase().endsWith('.onnx'));
    const cfg = files.find((f) => f.name.toLowerCase().endsWith('.json'));
    if (!onnx) throw new Error('Piper needs the .onnx model file');
    // Say WHY, not just what: the config carries the phoneme→id map, the sample
    // rate and the espeak language — none of it recoverable from the model.
    if (!cfg) throw new Error(`Piper also needs ${onnx.name}.json — it holds the phoneme map and sample rate`);

    // PHASES, not percentages. The runtime's own progress callback only fires
    // while DOWNLOADING, and these files are already on disk — so it would
    // report nothing for the entire real wait. The long pole is
    // InferenceSession.create() over a 63 MB graph, which is silent and can run
    // tens of seconds on first load. Naming the phase is the honest signal; a
    // fake percentage would be a progress bar that lies.
    onProgress({ phase: 'runtime', text: 'loading runtime…' });
    const e = await runtime();
    const base = onnx.name.replace(/\.onnx$/i, '');

    // The runtime has no seam for local model bytes: TtsSession always resolves
    // a voiceId through PATH_MAP and fetches HuggingFace. But getBlob() reads an
    // OPFS cache FIRST, keyed by basename. So seed the cache under the names it
    // will look for and it never touches the network. Its own cache, used the
    // way it already works — no fork, no patch.
    // The copy IS measurable — we are the ones moving the bytes — so stream it
    // in chunks and report real percentages rather than a single silent await.
    // This is the one phase where a number is honest, so it gets a number.
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('piper', { create: true });
    const totalMb = Math.round(onnx.size / 1e6);
    for (const [name, file] of [[`${base}.onnx`, onnx], [`${base}.onnx.json`, cfg]]) {
      const h = await dir.getFileHandle(name, { create: true });
      const w = await h.createWritable();
      const big = file.size > 4e6;
      if (big) {
        const CHUNK = 4 << 20;
        for (let off = 0; off < file.size; off += CHUNK) {
          const slice = file.slice(off, Math.min(off + CHUNK, file.size));
          await w.write(await slice.arrayBuffer());
          onProgress({
            phase: 'copy', pct: Math.round(((off + CHUNK) / file.size) * 100),
            text: `copying ${totalMb} MB — ${Math.min(100, Math.round(((off + CHUNK) / file.size) * 100))}%`,
          });
        }
      } else {
        await w.write(await file.arrayBuffer());
      }
      await w.close();
    }
    if (e.PATH_MAP && !e.PATH_MAP[base]) e.PATH_MAP[base] = `${base}.onnx`;

    let sr = null;
    try { sr = JSON.parse(await cfg.text())?.audio?.sample_rate ?? null; } catch { /* label only */ }

    // predict() is the convenience wrapper and it does NOT forward wasmPaths —
    // it always builds a session against hardcoded CDNs (cdnjs for ONNX Runtime,
    // jsDelivr for piper_phonemize). That means a network round trip per load
    // and no offline use at all, for a feature whose entire point is "the voice
    // is already on your machine." So construct the session directly and point
    // every asset at files we serve.
    // TtsSession is a SINGLETON: `if (_TtsSession._instance) return _instance`,
    // which silently ignores voiceId AND wasmPaths on every construction after
    // the first. Loading a second voice would keep speaking in the first one —
    // a bug that looks like "the picker did nothing." Drop the instance so each
    // load actually builds its own session.
    if (e.TtsSession._instance) e.TtsSession._instance = null;
    // The silent stretch: compiling the ONNX graph. Say so, and say it may take
    // a while, rather than leaving "loading…" to look like a hang.
    // THE UNMEASURABLE PHASE. InferenceSession.create() compiles a 63 MB graph
    // and reports nothing — there is no fraction to show, and inventing one
    // would be a progress bar that lies. But a static "preparing voice…" for
    // 30+ seconds is its OWN lie: it is indistinguishable from a hang, which is
    // exactly how R read it (2026-08-09).
    //
    // So: count UP. Elapsed seconds is true, visibly moving, and needs no
    // estimate. "still working, 12s" answers the only question a frozen label
    // cannot — is this alive?
    const t0 = performance.now();
    const ticker = setInterval(() => {
      const s = Math.round((performance.now() - t0) / 1000);
      onProgress({ phase: 'compile', elapsed: s, text: `preparing voice — ${s}s (first load is slow)` });
    }, 1000);
    onProgress({ phase: 'compile', elapsed: 0, text: 'preparing voice (first load is slow)' });
    // The library's own TtsSession is no longer built: we construct the ORT
    // session ourselves below, and building both would compile the 63 MB graph
    // TWICE per load. The OPFS seeding above still matters — it is how the model
    // bytes get somewhere the runtime can reach without touching the network.
    clearInterval(ticker);

    // MEASURE, DO NOT THEORIZE. R: "why is it so slow? Piper is supposed to be
    // stupid fast" — and she was right to push. I had two confident causes
    // (single-threaded ONNX; per-utterance phonemizer re-instantiation) and
    // BOTH were wrong: I measured the phonemizer at 34–52 ms, not seconds. The
    // model lives in the browser's own cache, so none of this is reproducible
    // from the server side — the only way to know is to time it where it runs.
    // Split predict from decode because they fail for different reasons: slow
    // predict = inference, slow decode = a main-thread copy of the samples.
    // 🔴 OUR OWN SESSION, BYPASSING predict(). Measured: the library rebuilds the
    // phonemizer module on EVERY call — 30,359ms in the browser, which was the
    // entire delay R heard. Its factory and session are WeakMap private fields,
    // so neither can be wrapped or reached; the only way out is to do both steps
    // ourselves and keep the module. See piperphon.js.
    //
    // Inference is cheap once phonemization is not being rebuilt: the same ORT
    // session, run directly.
    // 🔴 THE WEBGPU EP IS IN A DIFFERENT BUNDLE. The bare 'onnxruntime-web'
    // entry point does not carry it, so requesting executionProviders:['webgpu']
    // against it always throws and falls back to wasm — the feature would look
    // implemented and never once run. Import the webgpu bundle when the browser
    // has a GPU, the default otherwise.
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const ort = hasGpu
      ? await import('onnxruntime-web/webgpu').catch(async (e) => {
          console.warn('[voice] webgpu bundle failed to load, using wasm build:', e?.message || e);
          return import('onnxruntime-web');
        })
      : await import('onnxruntime-web');
    const cfgJson = JSON.parse(await cfg.text());
    const espeakVoice = cfgJson?.espeak?.voice || 'en-us';
    const inf = cfgJson?.inference || {};
    const wasmPaths = {
      piperData: new URL('../vendor/piper/piper_phonemize.data', import.meta.url).href,
      piperWasm: new URL('../vendor/piper/piper_phonemize.wasm', import.meta.url).href,
    };
      // 🔴 REPORT WHAT WE ACTUALLY GOT, NOT WHAT WE ASKED FOR.
      //
      // onnxruntime-web ships ONLY -threaded builds, every one of which needs
      // SharedArrayBuffer, which needs the page to be cross-origin isolated.
      // Without it ORT silently falls back to single-threaded — numThreads still
      // READS as 8 while one core does the work. That is the displayed-state-vs-
      // real-state trap, and it is exactly the kind of thing I have spent today
      // failing to catch by reading config instead of measuring.
      //
      // Default is min(hardwareConcurrency/2, 4) — capped at 4 even on a big
      // machine — so ask for more explicitly, then print what the runtime says.
      const cores = navigator.hardwareConcurrency || 4;
      const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
      const sab = typeof SharedArrayBuffer !== 'undefined';
      ort.env.wasm.numThreads = isolated && sab ? Math.min(cores, 8) : 1;
      ort.env.wasm.simd = true;
      ort.env.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
      console.log(`[voice] ORT: ${cores} cores · crossOriginIsolated=${isolated} · `
        + `SharedArrayBuffer=${sab} · numThreads=${ort.env.wasm.numThreads}`
        + (isolated && sab ? '' : '  ⚠️ SINGLE-THREADED — isolation headers missing'));

      // Session options were never set at all: no optimization level, no
      // execution mode. 'all' lets ORT fuse and constant-fold the graph, which is
      // free at run time and paid once at load.
      // 🔴 TRY WEBGPU FIRST, FALL BACK TO WASM.
      //
      // 553ms for 0.53s of audio is RTF ~1.07 on a MEDIUM (60 MB) model. The
      // ~65ms figure in the Piper README is NATIVE, and typically a low/x_low
      // model — never the same comparison. WASM SIMD cannot reach hardware AVX
      // or NEON, so the gap is structural, not a bug.
      //
      // But the jsep (WebGPU) binary already ships in onnxruntime-web, so the GPU
      // path costs no new dependency. A VITS decoder is mostly convolutions and
      // matmuls, which is exactly what a GPU is for. Falls back silently when
      // WebGPU is absent or the model has an op the EP does not implement — the
      // fallback is REQUIRED, not optional, because 'webgpu' throws rather than
      // degrading on unsupported operators.
      const buf = await onnx.arrayBuffer();
      const opts = { graphOptimizationLevel: 'all', executionMode: 'parallel' };
      let ortSession = null, usedEP = 'wasm';
      // 🔴 WEBGPU IS NOT OBVIOUSLY THE WIN FOR SHORT SPEECH. piper-plus and the
      // ORT docs both note that for SHORT utterances WASM SIMD+threads often
      // beats WebGPU, because per-call GPU setup dominates when there is little
      // work to do — and short utterances are exactly R's case ("hello").
      // So make it switchable and MEASURE, rather than assuming the GPU wins:
      //   localStorage.eidoTtsBackend = 'wasm' | 'webgpu' | 'auto' (default)
      const pref = (() => { try { return localStorage.getItem('eidoTtsBackend'); } catch { return null; } })();
      if (hasGpu && pref !== 'wasm') {
        try {
          const t = performance.now();
          ortSession = await ort.InferenceSession.create(buf, { ...opts, executionProviders: ['webgpu'] });
          usedEP = 'webgpu';
          console.log(`[voice] ORT session on WEBGPU in ${Math.round(performance.now() - t)}ms`);
        } catch (e) {
          console.warn('[voice] webgpu unavailable, falling back to wasm:', e?.message || e);
        }
      }
      if (!ortSession) {
        const t = performance.now();
        ortSession = await ort.InferenceSession.create(buf, { ...opts, executionProviders: ['wasm'] });
        console.log(`[voice] ORT session on WASM in ${Math.round(performance.now() - t)}ms`);
      }
      console.log(`[voice] inference backend: ${usedEP}`);

    const { phonemize, phonReady, warmPhonemizer } = await import('./piperphon.js');
    // BUILD THE PHONEMIZER NOW, not on the first word. It is ~27s and depends on
    // nothing but the wasm paths, so it belongs inside the load the user is
    // already watching rather than in front of their first utterance.
    await warmPhonemizer(wasmPaths, onProgress);

    const speak = async (text) => {
      const t0 = performance.now();
      const warm = phonReady();
      // 🔴 SHORT UTTERANCES NEED TERMINAL PUNCTUATION — a KNOWN Piper issue, not
      // ours (rhasspy/piper#252, "Single/short-word intonation and
      // pronunciation"). VITS is trained on full sentences, so a bare "hello"
      // with no sentence boundary falls outside the training distribution: the
      // duration predictor and the flow decoder both extrapolate, and the result
      // is the mangled output R heard ("sounds terrible if I just say hello but
      // perfect if I say Hello I'm speaking in Glados voice").
      //
      // Giving espeak a sentence terminator puts the model back in distribution.
      // It costs one character and no latency — the documented workaround, found
      // by SEARCHING after three wrong theories I measured and disproved.
      const spoken = /[.!?…,;:]\s*$/.test(text.trim()) ? text : `${text.trim()}.`;
      const ids = await phonemize(spoken, espeakVoice, wasmPaths);
      const t1 = performance.now();
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
        scales: new ort.Tensor('float32', Float32Array.from([
          inf.noise_scale ?? 0.667, inf.length_scale ?? 1.0, inf.noise_w ?? 0.8,
        ])),
      };
      const res = await ortSession.run(feeds);
      const t2 = performance.now();
      const raw = res[ortSession.outputNames[0]].data;      // Float32Array, -1..1
      const pcmData = new Int16Array(raw.length);
      for (let k = 0; k < raw.length; k++) {
        pcmData[k] = Math.max(-32768, Math.min(32767, Math.round(raw[k] * 32767)));
      }
      const rate = sr || 22050;
      const secs = pcmData.length / rate;
      console.log(`[voice] phonemize ${Math.round(t1 - t0)}ms${warm ? '' : ' (first, builds the module)'}`
        + ` · infer ${Math.round(t2 - t1)}ms · ${secs.toFixed(2)}s audio`
        + ` · RTF ${((t2 - t0) / 1000 / Math.max(secs, 1e-6)).toFixed(3)}` + ` · ${usedEP}`);
      return { pcm: pcmData, sampleRate: rate };
    };
    const label = `Piper: ${base}${sr ? ` (${sr} Hz)` : ''}`;
    setTtsSource(speak, label);
    return { speak, label };
  },
});
