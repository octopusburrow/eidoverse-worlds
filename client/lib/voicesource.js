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
  ttsEnabled = !!on && !!ttsFn;
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

function ensureGenerator() {
  if (genTrack && genTrack.readyState === 'live') return genTrack;
  // An ENDED generator is not a dead end: make a new one and hand it back. The
  // caller replaceTrack()s it onto the existing sender — no device, no
  // permission prompt, no renegotiation. This is the recovery a microphone
  // cannot offer, and the reason a TTS source is easier to keep alive than a
  // mic (R, 2026-08-08).
  genTrack = new MediaStreamTrackGenerator({ kind: 'audio' });
  writer = genTrack.writable.getWriter();
  return genTrack;
}

/** Speak text through the registered synthesizer. Silent no-op when TTS is off
 *  or unavailable — callers should not have to branch. */
export async function speak(text) {
  if (!isTtsEnabled() || !canSynthesize()) return false;
  let out;
  try {
    out = await ttsFn(text);
  } catch (e) { report('tts synthesize', e); return false; }
  if (!out?.pcm?.length) return false;
  const { pcm, sampleRate } = out;
  try {
    ensureGenerator();
    const per = Math.max(1, Math.round((sampleRate * CHUNK_MS) / 1000));
    // Wall-clock pacing: timestamps advance with real time, so the consumer
    // pulls frames at the rate a microphone would produce them.
    let t = performance.now() * 1000;
    for (let i = 0; i < pcm.length; i += per) {
      const slice = pcm.subarray(i, Math.min(i + per, pcm.length));
      const frame = new AudioData({
        format: 's16', sampleRate, numberOfFrames: slice.length,
        numberOfChannels: 1, timestamp: t, data: slice.slice(),
      });
      await writer.ready;
      await writer.write(frame);
      t += (slice.length / sampleRate) * 1e6;
    }
    return true;
  } catch (e) { report('tts write', e); return false; }
}

/** What voice.js calls instead of getUserMedia. Returns a MediaStream from
 *  whichever source this body uses. */
export async function voiceSource() {
  if (isTtsEnabled() && canSynthesize()) {
    return new MediaStream([ensureGenerator()]);
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
}

/** True when the current source's track has died and needs re-making. The
 *  liveness check nothing was doing — an `audio:ended` sender transmits
 *  silence forever while ICE and direction both look perfectly healthy. */
export function sourceIsDead(stream) {
  const t = stream?.getAudioTracks?.()[0];
  return !!t && t.readyState === 'ended';
}
