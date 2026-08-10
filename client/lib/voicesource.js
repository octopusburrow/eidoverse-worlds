// voicesource — WHERE YOUR VOICE COMES FROM.
//
// A participant's voice is a property of that participant, not a second client
// in the room. Before this, an agent spoke by running a WHOLE SEPARATE WebRTC
// client (voicebox/page.html) that joined under the agent's own name — which
// meant two sockets holding one identity, and the server's one-body-per-id rule
// evicting each in turn: 543 identity takeovers in a single session on
// 2026-08-08. Renaming that client is not the fix; not being a client is.
//
// So: voice.js asks THIS module for a MediaStream instead of calling
// getUserMedia directly. Everything downstream — the sender, replaceTrack,
// distance falloff, volumeFor(), consent, mute — takes a MediaStream and does
// not care where it came from. One seam, and an agent's synthesized speech gets
// spatialization and consent for free rather than needing a parallel path.
//
//   humans → getUserMedia (unchanged; the browser/OS default device)
//   agents → a local TTS function, registered by whatever is driving the body
//
// LOCAL, always. Synthesis on the client costs the server nothing and scales
// with clients rather than with the room (R, 2026-08-08).

import { report } from './core.js';

// The registered TTS source. null = ordinary microphone.
//   fn: (text: string) => Promise<{pcm: Int16Array, sampleRate: number}>
// A *function pointer*, deliberately: an agent points at its own synthesizer
// and nothing here needs to know what produces the samples.
let ttsFn = null;
let ttsName = '';        // shown in the audio panel so it is never ambiguous
let ttsEnabled = false;  // OFF by default — speaking is opt-in, like a mic

let genTrack = null;     // the live MediaStreamTrackGenerator, if any
let writer = null;

export const ttsAvailable = () => !!ttsFn;
export const ttsVoiceName = () => ttsName;
export const isTtsEnabled = () => ttsEnabled && !!ttsFn;

/** Point this body's mouth at a synthesizer. Called by an agent harness, never
 *  by the UI. Passing null reverts to the microphone. */
export function setTtsSource(fn, name = 'TTS') {
  ttsFn = fn || null;
  ttsName = fn ? name : '';
  if (!fn) ttsEnabled = false;
}

// ── the human path to the SAME seam ─────────────────────────────────────────
// A human picking a voice and an agent registering one MUST be the same call,
// or the two drift and "how is that one speaking?" stops having one answer.
// setTtsSource is that call for both; a UI is only ever a wrapper over it.
//
// 🔴 The browser's own speechSynthesis CANNOT be that source, and this is a
// hard platform limit rather than something to work around. The Web Speech API
// offers no route from speak() to an AudioNode, MediaStream or Blob — on Linux
// synthesis does not even occur in the browser (speech-dispatcher over a
// socket), so there is nothing to capture. The spec request to allow
// SpeechSynthesis → MediaStreamTrack (WICG/speech-api#69) is still open and
// unimplemented. A first draft here routed speak() through a
// MediaStreamDestination + MediaRecorder; that records SILENCE, because
// nothing is ever connected to the destination. It cannot be.
//
// So a human who wants a synthesized voice needs a source that RETURNS SAMPLES:
//   • a local synthesizer over the same ws protocol piperbridge.js uses
//   • an in-browser WASM TTS (Piper via onnxruntime-web, kokoro-js, sherpa-onnx)
//   • a cloud TTS returning wav/mp3, decoded with decodeAudioData
// All three are ordinary `(text) => {pcm, sampleRate}` functions and all three
// go through setTtsSource unchanged. The seam is already symmetric; what a
// human lacks is a bundled source, not a different API.
//
// The in-browser option is REAL and close: kokoro-js runs an 82M TTS entirely
// client-side (WASM, or WebGPU where available) and tts.generate(text) hands
// back samples — ~82MB cached after first load, 21 voices, no server and no
// install. Piper-via-onnxruntime-web is the same shape (~75MB, VITS, ~0.03
// realtime factor, first audio ~40ms). Either is a drop-in `(text) =>
// {pcm, sampleRate}`; neither needs one line of this file to change.
//
// So the honest statement is narrow: the browser's BUILT-IN speechSynthesis
// cannot feed the mic lane. Every other synthesizer can, including ones that
// run in the same page. Do not read the paragraph above as "browsers cannot do
// TTS into WebRTC" — they can, and this codebase already does it with Piper
// over a socket (2.70s of audio in 0.08s, measured 2026-08-08).
//
// Until a source is bundled the UI row stays honest: toggle disabled, field
// reads "system default (microphone)". No pretend voice picker.

/** The audio panel's toggle. Humans leave this off and use a mic; an agent
 *  turns it on once its source is registered. */
export function setTtsEnabled(on) {
  const was = ttsEnabled;
  ttsEnabled = !!on && !!ttsFn;
  // 🔴 EITHER ORDER MUST WORK. voiceSource() mixes the synth in when the mic
  // opens — but enabling TTS AFTER the mic is already live used to just set a
  // flag, so nothing was ever connected and speech went nowhere. That is the
  // mirror of the bug this fixes, and shipping only one direction would be the
  // asymmetric repair this codebase keeps producing. Wire (or unwire) it here
  // too, so mic-then-TTS and TTS-then-mic reach the same place.
  if (ttsEnabled !== was && typeof window !== 'undefined') {
    import('./micgate.js').then(async (m) => {
      if (!m.isGated?.()) return;              // no lane yet; voiceSource will do it
        // MIC BEATS TTS: while a real microphone is live, synthesized speech does
        // not join the lane at all (R, 2026-08-09). Ticking TTS with the mic on
        // therefore arms it for LATER — the moment the mic goes off, voiceSource
        // falls back to the generator with nothing to re-enable. Both directions
        // handled here; fixing only one is the asymmetric repair the comment
        // above warns about.
        const micLive = (await import('./voice.js')).micOn?.();
        if (ttsEnabled && canSynthesize() && !micLive) {
          startPacer(); m.mixSynthTrack(ensureGenerator());
        } else m.unmixSynth();
    }).catch(() => {});
  }
  return ttsEnabled;
}

// ── the generator ───────────────────────────────────────────────────────────
// MediaStreamTrackGenerator fed timestamped PCM at WALL-CLOCK pace. The pacing
// is the load-bearing part and it is not ours: voicebox/page.html found that a
// realtime AudioContext in a headless browser runs its clock at ~1% and stalls
// mid-run. Frames as DATA, paced by the wall clock, is what fixed it there.
//
// Chromium-only today. Firefox has no MediaStreamTrackGenerator, so an agent
// there falls back to the microphone path (i.e. stays silent) rather than
// throwing — a missing voice must never take the body down with it.
const CHUNK_MS = 20;

export const canSynthesize = () => typeof MediaStreamTrackGenerator !== 'undefined';

// Fired when a DEAD generator is replaced by a live one. The new track is a
// different object, so every sender still holding the old one transmits silence
// forever — ICE healthy, direction sendonly, nothing to see. voice.js listens
// and replaceTrack()s it onto the existing senders (no renegotiation).
// sourceIsDead() was written for exactly this and had ZERO callers, the same
// way toggleMute did while the HUD called the destructive path.
let onRebuild = null;
export const setGeneratorRebuildHook = (fn) => { onRebuild = fn; };
/** Test seam: fire the installed hook without having to kill a real generator
 *  (MediaStreamTrackGenerator does not exist under happy-dom). */
export const __fireRebuild = (track) => onRebuild?.(track);

// Exported so the mic-off handover can wire the synth in (voice.js). Internal
// to the module otherwise — nothing else should be minting generators.
export function ensureGenerator() {
  if (genTrack && genTrack.readyState === 'live') return genTrack;
  const replacing = !!genTrack;
  // An ENDED generator is not a dead end: make a new one and hand it back. The
  // caller replaceTrack()s it onto the existing sender — no device, no
  // permission prompt, no renegotiation. This is the recovery a microphone
  // cannot offer, and the reason a TTS source is easier to keep alive than a
  // mic (R, 2026-08-08).
  genTrack = new MediaStreamTrackGenerator({ kind: 'audio' });
  writer = genTrack.writable.getWriter();
  if (replacing) {
    console.warn('[voice] generator was dead — rebuilt; re-binding senders');
    try { onRebuild?.(genTrack); } catch (e) { report('generator rebind', e); }
  }
  return genTrack;
}

/** Speak text through the registered synthesizer. Silent no-op when TTS is off
 *  or unavailable — callers should not have to branch. */
export async function speak(text) {
  // EVERY REFUSAL SAYS WHY. This function had five silent `return false`
  // paths, so "nothing came out" looked identical whether TTS was off, the
  // sender was missing, or the synthesizer returned empty. A whole evening was
  // spent unable to tell those apart (2026-08-08).
  if (!isTtsEnabled()) { console.warn(`[voice] speak refused: tts off (enabled=${ttsEnabled} fn=${!!ttsFn})`); return false; }
  // NO SINK IS NOT NO REASON TO SPEAK. This used to refuse outright, which meant
  // a human who picked a voice and typed heard nothing until they also opened
  // their mic — an unrelated control, and not one anybody would guess at. With
  // sidetone we can still play it locally; only TRANSMISSION needs the lane.
  // Say which of the two happened rather than silently doing half.
  if (!canSynthesize() && !sidetone()) {
    console.warn('[voice] speak refused: no generator sink and sidetone off');
    return false;
  }
  console.log(`[voice] synthesizing ${text.length} chars…`);
  let out;
  try {
    out = await ttsFn(text);
  } catch (e) { report('tts synthesize', e); return false; }
  if (!out?.pcm?.length) { console.warn('[voice] synthesizer returned no pcm'); return false; }
  console.log(`[voice] got ${out.pcm.length} samples @${out.sampleRate}Hz — feeding sender`);
  // QUEUE IT — DO NOT PUSH IT. The frames are handed to a wall-clock pacer that
  // is already running; see the pacer below for why the track must never starve.
  enqueue(out.pcm, out.sampleRate);
  return true;
}

// ── the pacer: A MOUTH IS ALWAYS OPEN ──────────────────────────────────────
// THE BUG THIS FIXES (2026-08-08): speak() used to write its frames in a tight
// await loop and then stop. Between utterances the generator got NOTHING, so
// the track was starved — and a starved MediaStreamTrackGenerator is not a
// quiet microphone, it is a track with no media to encode. Every local check
// passed (samples written, speak() returned true, sender bound, ICE connected)
// and the room heard silence.
//
// The workbench rig got this right and I dropped it in the port: it runs a
// 10ms pacer that writes exactly as many frames as wall time OWES, filling
// them with speech when there is speech and with SILENCE when there is not, so
// the track never starves. Speech is what fills the frames; the frames happen
// regardless. That is what makes this behave like a microphone, which is the
// entire point of the source design — a mic keeps producing silence when you
// are not talking, and the mesh keeps carrying it.
const RATE_HINT = 22050;
const FRAME = Math.round(RATE_HINT / 50);   // 20ms
let queue = [];            // pending {pcm, sampleRate}
let qOff = 0;              // read offset into queue[0]
let playhead = 0;          // samples emitted since the pacer started
let t0 = 0;
let pacer = null;

/** SIDETONE — hearing your own synthesized voice.
 *
 *  R, 2026-08-09: "I don't hear anything when I type into the chat box. Hearing
 *  yourself as a human using TTS is half the fun."
 *
 *  She is right, and the omission was structural: speak() feeds the SENDER, so
 *  the samples go to the room and never to your own speakers. Everyone else
 *  hears you; you are the one person who cannot. (Telephony calls this
 *  sidetone, and leaves it in deliberately — a line with none sounds dead.)
 *
 *  A separate AudioContext path, not a loopback of the peer connection: we own
 *  the PCM before it is paced onto the track, so this stays exact and adds no
 *  round trip. Off for renderers/spectators, which have no business making
 *  noise.
 */
let monitorCtx = null;
let monitorOn = (() => {
  try { return localStorage.getItem('eido.ttsSidetone') !== 'off'; } catch { return true; }
})();
export const sidetone = (on) => {
  if (on !== undefined) {
    monitorOn = !!on;
    try { localStorage.setItem('eido.ttsSidetone', on ? 'on' : 'off'); } catch { /* private mode */ }
  }
  return monitorOn;
};

function monitor(pcm, sampleRate) {
  if (!monitorOn || !pcm?.length) return;
  try {
    monitorCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    // A context created before a user gesture starts suspended; a resume() that
    // never lands must not throw away the sample.
    if (monitorCtx.state === 'suspended') void monitorCtx.resume();
    const buf = monitorCtx.createBuffer(1, pcm.length, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = monitorCtx.createBufferSource();
    const g = monitorCtx.createGain();
    // Slightly under unity: your own voice should sit behind the room, the way
    // sidetone always does, rather than competing with it.
    g.gain.value = 0.8;
    src.buffer = buf;
    src.connect(g).connect(monitorCtx.destination);
    src.start();
  } catch (e) { console.warn('[voice] sidetone failed (still transmitting):', e?.message || e); }
}

function enqueue(pcm, sampleRate) {
  monitor(pcm, sampleRate);          // hear yourself, then send
  // Deliberately NOT gated on having a sender. Two traps I walked into here:
  // canSynthesize() tests browser SUPPORT for MediaStreamTrackGenerator (not an
  // open lane), and `genTrack` is CREATED by ensureGenerator() inside
  // startPacer() — so gating on either would block the first utterance and stop
  // the generator from ever being built. The pacer's own `if (!writer) return`
  // already makes a senderless queue harmless; it drains once a lane exists.
  if (!canSynthesize()) return;
  queue.push({ pcm, sampleRate });
  startPacer();
}

/** Drain the queue into one frame; zeros when there is nothing to say. */
function fillSpeech(out) {
  let i = 0;
  while (i < out.length) {
    const head = queue[0];
    if (!head) break;                       // nothing queued → leave silence
    const src = head.pcm;
    const n = Math.min(out.length - i, src.length - qOff);
    for (let k = 0; k < n; k++) out[i + k] = src[qOff + k] / 32768;
    i += n; qOff += n;
    if (qOff >= src.length) { queue.shift(); qOff = 0; }
  }
}

export function startPacer() {
  if (pacer) return;
  ensureGenerator();
  t0 = performance.now();
  playhead = 0;
  pacer = setInterval(() => {
    if (!writer) return;
    const owed = Math.floor(((performance.now() - t0) / 1000) * RATE_HINT) - playhead;
    for (let n = 0; n + FRAME <= owed; n += FRAME) {
      const data = new Float32Array(FRAME);
      fillSpeech(data);
      try {
        writer.write(new AudioData({
          format: 'f32', sampleRate: RATE_HINT, numberOfFrames: FRAME,
          numberOfChannels: 1, timestamp: Math.round((playhead / RATE_HINT) * 1e6), data,
        }));
      } catch (e) { report('tts write', e); }
      playhead += FRAME;
    }
  }, 10);
}

/** Stop pacing (releases the interval). The track stays live. */
export function stopPacer() {
  if (pacer) { clearInterval(pacer); pacer = null; }
  queue = []; qOff = 0;
}

/** Probe seam: is the mouth open, and how much is waiting to be said? */
export const mouthInfo = () => ({ pacing: !!pacer, queued: queue.length, playhead });

/** What voice.js calls instead of getUserMedia. Returns a MediaStream from
 *  whichever source this body uses. */
export async function voiceSource() {
  // 🔴 NOT AN EITHER/OR ANY MORE. This used to return the synthesizer INSTEAD of
  // the microphone whenever TTS was on — an agent-shaped assumption (a synth
  // replaces a mouth) that silently broke every human who enabled TTS before
  // opening their mic: the mesh got a generator, forever, and every check
  // reported healthy (R, 2026-08-09).
  //
  // A body has ONE mic. If this machine has no microphone at all — an agent —
  // the generator IS the source. Otherwise the mic is the source and synthesized
  // speech is MIXED into the same lane past the gate (see micgate.mixSynthTrack),
  // because a synth is not a replacement for a mouth; it is another thing making
  // sound in the same room.
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
      // 🔴 A LIVE MIC WINS OUTRIGHT — it does not share the lane (R, 2026-08-09).
      // This used to MIX synthesized speech into the mic's lane, on the theory
      // that a synth is "another thing making sound in the same room". But
      // nobody wants both: a human with a working mic just talks. Mic on means
      // your own voice, full stop; mic off drops straight back to TTS with
      // nothing to re-enable, because the TTS setting is left STANDING rather
      // than cleared — that is what makes this a priority, not a toggle.
      // The generator is deliberately not started: an idle pacer feeding a lane
      // that will not carry it is pure cost.
    return mic;
  } catch (e) {
    // No microphone, or permission refused. If we can synthesize, that is the
    // whole voice — this is the agent path, and the path a human takes when they
    // have no mic but still want to be heard.
    if (isTtsEnabled() && canSynthesize()) {
      const track = ensureGenerator();
      startPacer();
      return new MediaStream([track]);
    }
    throw e;
  }
}

/** True when the current source's track has died and needs re-making. The
 *  liveness check nothing was doing — an `audio:ended` sender transmits
 *  silence forever while ICE and direction both look perfectly healthy. */
export function sourceIsDead(stream) {
  const t = stream?.getAudioTracks?.()[0];
  return !!t && t.readyState === 'ended';
}

// ── speak your own says ─────────────────────────────────────────────────────
// world.js already emits 'speech' for every say that was not already performed
// (args.spoken marks the ones a voice paced itself, so this cannot
// double-speak). A body with a synthesizer listens for its OWN and voices it:
// that is the entire bridge from "posted text" to "made a sound", and it runs
// through the ordinary sender, so distance, the category slider and consent all
// apply exactly as they do to a microphone.
export function speakOwnSays(bus, myId) {
  bus.on('speech', ({ actor, text }) => {
    const mine = actor === myId();
    if (!mine) return;                       // someone else's say: not ours to voice
    if (!isTtsEnabled()) { console.warn(`[voice] own say NOT spoken — tts disabled`); return; }
    console.log(`[voice] own say → speaking: "${String(text).slice(0, 60)}"`);
    void speak(text);
  });
}

/** THE ONE QUESTION A SILENT VOICE CANNOT ANSWER FROM INSIDE: is the track we
 *  are feeding the same object the peer connection is sending? speak() can
 *  return true — synthesized, written, no errors — while the samples pour into
 *  an orphan generator because the mic lane opened from a different source.
 *  Every local check still passes and the room hears nothing. This exposes the
 *  identity so a probe can compare it against the sender's track. */
export const genTrackInfo = () => (genTrack
  ? { id: genTrack.id, kind: genTrack.kind, readyState: genTrack.readyState, enabled: genTrack.enabled }
  : null);

