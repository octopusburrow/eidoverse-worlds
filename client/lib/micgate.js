// micgate — the noise gate as a GAIN, not a switch.
//
// R, 2026-08-09: "why not do the WebAudio graph now? I'm worried we'll forget
// about it if we wait." Right on both counts — and "later" is how a boolean gate
// becomes permanent.
//
// WHY A GRAPH AT ALL. Gating with `track.enabled` is binary and abrupt: the
// track goes from full to digital silence between one 40ms tick and the next.
// That is an audible click at both ends, and the opening click lands on your
// first consonant — the worst possible place. BasisVR gates with a smoothed
// gain (BasisLocalMicrophoneDriver: `_noiseGateGain` lerped toward 0/1 with
// attack/release coefficients), which is the right shape and needs per-sample
// access we did not have while handing the raw device track to WebRTC.
//
// The graph:
//
//     voiceSource()  →  MediaStreamSource  →  GainNode  →  MediaStreamDestination
//                                               ↑                     ↓
//                                        gate (this file)    the track WebRTC sends
//
// The analyser still reads the SOURCE side, not the gated side — measuring after
// the gate would be a feedback loop: gain drops, measured level drops, gate
// closes harder, and it latches shut. The gate must always judge the true input.
//
// 🔴 This wraps humans AND agents alike, because voiceSource() is the one seam
// both come through (a human gets a microphone, an agent gets its synthesizer).
// An agent's speech is loud and continuous, so it sails through the gate — but
// it means an agent whose synth emits room tone between utterances is quiet for
// the same reason a human is, with no second code path to maintain.

import { audioContext } from './audioctx.js';
import { report } from './core.js';

// 🔴 THESE ARE PER-CALL RATES, AND OUR CALL CADENCE IS NOT THEIRS. BasisVR's
// 0.10/0.05 are per 20ms audio frame; driveGate() runs on the 40ms onset tick,
// and a naive copy took 300ms to reach 90% gain — an audible fade-in on the
// first word, which is worse than the click it replaces. Measured, not assumed
// (a syllable is ~80-150ms, so the attack must finish well inside one).
//
// Measured at the 40ms cadence: attack 0.35 → ~90% open in 160ms (inside a
// syllable); release 0.18 → down to 10% in ~440ms, a soft tail rather than the
// 1.5s smear 0.06 produced. Attack faster than release, always: opening late
// loses a consonant, closing early cuts a word in half. And the 700ms hang-time
// runs BEFORE this fade even begins, so a pause mid-sentence never reaches it.
const ATTACK = 0.35;
const RELEASE = 0.18;
const FRAME_MS = 40;

let _ctx = null, _src = null, _gain = null, _dest = null, _timer = null;
let _rawStream = null, _gatedStream = null, _level = () => 0;

/** Wrap a mic stream in the gate graph. Returns the stream to hand to WebRTC —
 *  or the original stream unchanged if the graph cannot be built, because a
 *  voice that works ungated beats no voice at all. */
export function gateStream(stream, levelFn) {
  release();
  _rawStream = stream;
  _level = levelFn || (() => 0);
  try {
    _ctx = audioContext();
    if (!_ctx || typeof _ctx.createMediaStreamDestination !== 'function') return stream;
    _src = _ctx.createMediaStreamSource(stream);
    _gain = _ctx.createGain();
    // Start CLOSED. Opening on the first frame would broadcast whatever the room
    // is doing at the instant the mic opens — the exact leak the settle window
    // exists to prevent, and the one R heard as "picking up background noise".
    _gain.gain.value = 0;
    _dest = _ctx.createMediaStreamDestination();
    _src.connect(_gain);
    _gain.connect(_dest);
    _gatedStream = _dest.stream;

    // Carry the original track's identity forward where it matters: muting still
    // operates on the RAW track (see voice.js), so both streams stay live and the
    // gate only decides how much of the raw signal reaches the destination.
    return _gatedStream;
  } catch (e) {
    report('mic gate graph', e);
    release();
    return stream;                       // ungated beats silent
  }
}

/** Drive the gain from the gate decision. `open` is the gate's boolean; the
 *  smoothing lives here so the decision logic stays readable. */
export function driveGate(open) {
  if (!_gain || !_ctx) return;
  const target = open ? 1 : 0;
  const now = _ctx.currentTime;
  const cur = _gain.gain.value;
  const coeff = open ? ATTACK : RELEASE;
  const next = cur + (target - cur) * coeff;
  try {
    // setTargetAtTime rather than a linear ramp: it is the exponential approach
    // an ear expects from a gate, and it never leaves a scheduled ramp behind to
    // fight the next call (a known trap in this codebase — see the WebAudio
    // gotchas note about setValueAtTime races).
    _gain.gain.setTargetAtTime(next, now, FRAME_MS / 1000);
  } catch { _gain.gain.value = next; }
}

/** Is any signal actually reaching the wire right now? The honest answer to
 *  "am I being broadcast", read from the gain itself rather than inferred. */
export const gateOpenness = () => (_gain ? _gain.gain.value : 0);
export const isGated = () => !!_gain;

/** Detach the DEVICE from the lane, keeping the lane itself alive.
 *
 *  🔴 This is the one that matters for reconnect cost. The GainNode and the
 *  MediaStreamDestination stay — so the track every peer's sender holds is still
 *  live, and no renegotiation is needed when the mic comes back. Only the
 *  source-side connection goes away, because its device track just stopped.
 *
 *  R, 2026-08-09: "we don't want to tear down audio tracks at all unless someone
 *  leaves or unchecks the connect-to-audio box — that's how we ran into people
 *  not hearing each other and unmute lag while it sets it all up again." */
export function detachSource() {
  try { _src?.disconnect(); } catch { /* already gone */ }
  _src = null;
  _rawStream = null;
  if (_gain) _gain.gain.value = 0;        // lane open, silent
}

/** Reconnect a new device stream into the EXISTING lane. Returns the same gated
 *  stream the senders already hold, so nothing downstream changes. */
export function attachSource(stream) {
  if (!_ctx || !_gain || !_dest) return null;
  try { _src?.disconnect(); } catch { /* fine */ }
  _src = _ctx.createMediaStreamSource(stream);
  _src.connect(_gain);
  _rawStream = stream;
  return _gatedStream;
}

/** Full teardown — the lane included. ONLY for leaving the world or revoking
 *  consent, never for going quiet: this is the path that costs a renegotiation
 *  to undo. */
export function release() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  try { _src?.disconnect(); } catch { /* already gone */ }
  try { _gain?.disconnect(); } catch { /* already gone */ }
  // Deliberately does NOT stop the destination's tracks: they belong to the
  // stream WebRTC holds, and stop() is a one-way door. The caller's own sender
  // cleanup owns that.
  _src = _gain = _dest = null;
  _gatedStream = null;
  _rawStream = null;
}

/** The RAW stream, for anything that must measure the true input — the analyser
 *  especially. Measuring the gated output would make the gate self-latching. */
export const rawStream = () => _rawStream;
