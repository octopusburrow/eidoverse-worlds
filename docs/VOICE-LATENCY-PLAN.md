# Re-distilling clockwork through an MB-iSTFT vocoder

*Written 2026-08-09 by Hesperus, after an evening establishing that the browser
latency problem is the VOCODER, not the model or the runtime.*

## Why

Measured on Burrow, 2026-08-09:

| where | model | short utterance |
|---|---|---|
| native CPU | `en_US-amy-medium` (Piper VITS) | **133 ms** |
| browser WASM | same class | **~550 ms** |

4× penalty, and it is structural. Standard Piper is VITS + **HiFi-GAN**, whose
vocoder upsamples to 22 050 samples/sec through stacked **transposed
convolutions** — precisely the operation WASM SIMD does worst relative to native
AVX/NEON.

**MB-iSTFT** replaces that with multi-band inverse STFT + a PQMF filter bank:
predict spectral coefficients, reconstruct with FFTs. piper-plus measures
**2.21× on CPU** for the swap, and FFTs are far friendlier to both WASM and GPUs
than conv stacks.

Also measured and ruled out, so nobody repeats them:

- **INT8 dynamic quantization: 4.6× SLOWER** (fp32 120 ms → int8 549 ms). It
  wraps every matmul in dequantize ops; on a conv-heavy graph that swamps the
  8-bit win.
- **WebGPU for Piper: structurally blocked.** The VITS graph contains
  `RandomNormalLike`, which is absent from ORT's WebGPU operator table. VITS
  samples noise, so that op sits in the hot path, forcing a partition and
  GPU→CPU→GPU round-trips. (This is why `GatherND_2927` failed — it is
  downstream of the boundary. GatherND itself IS supported.)
- **Kokoro: 8.4 s/sentence on this machine** — it is the TEACHER we distilled
  away from in July, not an alternative.

## The blocker I reported earlier was wrong

I said piper-plus's own G2P made this impossible. Its **training guide** says
otherwise: English preprocessing **requires espeak-ng with `--language en-us`**,
and their `g2p-en` backend "is not yet integrated into the preprocessing
pipeline" — inference only. So training phonemes come from the same espeak-ng
our current models use. The incompatibility is with their **shipped voices**,
not with the pipeline.

## The plan

🔴 **Correction to my first draft: the corpus is baked ON THE WORKSTATION, not on
Burrow.** `distill/README.md` line 9: *"~10 min on the 4080 for 720 Harvard
sentences"*. I searched Burrow and the Syncthing folder for a corpus that was
never here, then wrote a plan around a 2.6-hour Burrow bake that does not exist.

The whole pipeline lives on the GPU box — bake, train, export — and the corpus
never crosses the wire. **Only the finished ~63 MB `.onnx` comes back to Burrow.**
That makes stage 1 ~10–30 minutes on the same machine as stage 2, not a separate
long pole.

### 1. Bake the corpus — on the workstation

Unchanged from `PLAYBOOK.md`, and this is the part that makes the whole thing
cheap: **the corpus is vocoder-agnostic.** It is wav + text. Nothing about it
knows or cares which decoder will be trained on it.

- CMU Arctic prompts (1132), which beat Harvard for coverage
- teacher = the Kokoro blend `bm_lewis*0.5 + af_nicole*0.5 @ speed 1.25`
- **base only, NO post chain** — the DSP is portable numpy; baking ringmod or
  bitcrush in makes the student imitate the artifacts and smears them
- `gen_corpus.py --voice <teacher>` → ljspeech layout (`wav/` + `metadata.csv`)

**Baked on the 4080: ~10 min for 720 lines** (README line 9), scaling to 2–5k.
The 8.4 s/sentence figure is Burrow CPU and does not apply on the GPU box —
another reason this stage belongs there. Check whether July's corpus survives on
the workstation before re-rendering; if it does, stage 1 is skipped entirely.

### 2. Train the MB-iSTFT student — workstation GPU, ~4.5 h

```
piper-plus preprocess --dataset-format ljspeech --language en-us ...
piper-plus train \
  --resume_from_checkpoint <nearest existing model, same sample rate> \
  --c-sub-stft 1.0 \
  --sub-stft-fft-sizes 171,384,683 \
  --sub-stft-hop-sizes 10,30,60 \
  --sub-stft-win-sizes 60,150,300 \
  --batch-size 32 --max-phoneme-ids 400
```

- fine-tune, do not train from scratch: ~1000 extra epochs vs ~2000 cold
- a 24 GB card (3090/4090) handles `--batch-size 32`; add `--no-wavlm` on 16 GB
- the checkpoint must match sample rate, but need not match language
- done when `loss_disc_all` flattens

Every trap from July's `PLAYBOOK.md` §2 still applies (monotonic_align build,
PosixPath pickle, `--model.warmstart_ckpt`, install torchaudio or Lightning
crashes at first validation, keep the machine awake).

### 3. Audition and decide — ears, then wire

- render the audition set: base + clockwork-post, teacher vs candidate
- UTMOS on **base renders only**; post artifacts confuse a naturalness metric
- **Riannon's ears pick the winner. Numbers rank; they don't decide.**
- bar to clear: UTMOS ≈ 3.6 (July's student hit 3.636 vs teacher 3.607)

### 4. The measurement that justified all of it

Bench the new model in the browser against the current one, same text, same
machine:

```js
await ttsBench('hello')     // then swap models and repeat
```

**If MB-iSTFT does not beat ~550 ms in a browser, stop.** The whole case rests
on the vocoder being the bottleneck; if the number does not move, that
hypothesis was wrong and no amount of retraining fixes it.

## The other thread: why is there no fast web vocoder?

R, 2026-08-09: *"maybe just no one has thought to write a fast one yet."*

Worth taking seriously. The vocoder is the expensive half and it is **not a
neural mystery** — MB-iSTFT is FFT + a filter bank, both of which have excellent
WASM SIMD and WebGPU implementations that nobody has wired into a TTS path.

A concrete experiment, cheap to try:

1. export the acoustic model only (stop at spectral coefficients)
2. run the iSTFT + PQMF in **WebAudio or a WASM FFT library** instead of as ONNX
   graph nodes
3. compare against running the whole graph in ORT

If that wins, the artefact is a *general* piece of infrastructure — a fast
browser vocoder that any MB-iSTFT model could use — not just our voice. That is
the version of this worth publishing.
