import { test, expect } from "bun:test";
import { decodeWavToPcm } from "../client/lib/wavpcm.js";

// Build a real WAV the way piper emits one, then prove we read it back.
function makeWav(sampleRate: number, samples: Int16Array): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const dv = new DataView(buf);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  tag(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  tag(36, "data"); dv.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return buf;
}

test("reads piper's 22050Hz mono output", () => {
  const src = Int16Array.from([0, 1000, -1000, 32767, -32768]);
  const { pcm, sampleRate } = decodeWavToPcm(makeWav(22050, src));
  expect(sampleRate).toBe(22050);
  expect([...pcm]).toEqual([...src]);
});

test("does NOT assume 22050 — a different rate is read from the header", () => {
  // assuming the rate would play a 16k voice back at the wrong pitch with
  // nothing to indicate why, which is the failure this parse exists to avoid
  const { sampleRate } = decodeWavToPcm(makeWav(16000, Int16Array.from([1, 2, 3])));
  expect(sampleRate).toBe(16000);
});

test("rejects a non-WAV instead of returning garbage", () => {
  const junk = new ArrayBuffer(64);
  expect(() => decodeWavToPcm(junk)).toThrow();
});

test("survives an extra chunk before 'data' (LIST is common)", () => {
  const base = makeWav(22050, Int16Array.from([5, 6, 7, 8]));
  // splice a LIST chunk between fmt and data
  const extra = 12;
  const out = new ArrayBuffer(base.byteLength + extra);
  const s = new Uint8Array(base), d = new Uint8Array(out);
  d.set(s.subarray(0, 36), 0);
  const dv = new DataView(out);
  [..."LIST"].forEach((c, i) => dv.setUint8(36 + i, c.charCodeAt(0)));
  dv.setUint32(40, 4, true);
  d.set(s.subarray(36), 36 + extra);
  dv.setUint32(4, out.byteLength - 8, true);
  const { pcm, sampleRate } = decodeWavToPcm(out);
  expect(sampleRate).toBe(22050);
  expect([...pcm]).toEqual([5, 6, 7, 8]);
});
