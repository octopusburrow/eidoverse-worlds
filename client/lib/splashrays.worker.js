// The splash rays, off the main thread: a WebGL2 fragment shader on an
// OffscreenCanvas inside a Worker. Why a worker (R, 09-05): the splash must
// animate every frame REGARDLESS of what loading does to the main thread —
// GLB parses stall it for 300 ms–2 s at a time — and stop only if the tab is
// hard-frozen (which kills this worker too). Why a shader: smooth math in 8
// bits still bands at these luminances unless you dither, and only a shader
// can dither. Soft vertical rays in the SteamVR key-art manner, two tints,
// alpha eased from 0 over 1.5 s so it never pops in.
let gl, prog, uT, uRes, uRamp, uCalm, canvas, t0, raf = 0, calm = 1;

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform float t, ramp, calm; uniform vec2 res; out vec4 o;
// hash / value noise / fbm — the usual, in one dimension for the shafts and two for the haze
float h1(float p){ return fract(sin(p * 127.1) * 43758.5453); }
float n1(float p){ float i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float fbm1(float p){ return 0.5 * n1(p) + 0.25 * n1(p * 2.07 + 5.1) + 0.125 * n1(p * 4.13 + 9.7) + 0.0625 * n1(p * 8.31 + 1.3); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 uv = gl_FragCoord.xy / res;            // (0,0) bottom-left
  float tt = t * calm * 0.22;                  // slow, oily (R: 0.4× was still too quick)
  // CAUSTICS (R, 15:01): light diffracting onto a wall from under water —
  // wide, slow, folding bands; no tips. The x axis is scaled DOWN 3× so
  // bands are broad, and a slow 2-D warp slides the pattern so bands fold
  // over each other instead of drifting rigidly.
  float px = uv.x * res.x / res.y / 3.0;
  float warp = n2(vec2(px * 1.3 + tt * 0.21, uv.y * 0.9 - tt * 0.13)) - 0.5;
  float x1 = px + warp * 0.35;
  float bands = fbm1(x1 * 5.5 + tt * 0.5) * 0.65 + fbm1(x1 * 11.0 - tt * 0.27 + 7.0) * 0.35;
  bands = smoothstep(0.30, 0.72, bands);                    // the fbm's real range
  bands = bands * bands * (3.0 - 2.0 * bands);              // gentle contrast, no hard cores
  // heights come from their OWN slow field, not from brightness — so bands
  // end in soft shoulders at different heights, never a point
  float top = 0.30 + 0.40 * n1(px * 2.2 + tt * 0.17 + 3.0);
  float fall = smoothstep(top, top * 0.15, uv.y);           // flat near the ground, soft shoulder at the top
  float beam = bands * fall;
  vec3 brand = vec3(0.561, 0.910, 0.784);
  float a = clamp(beam * 0.17, 0.0, 0.25) * ramp;           // R: half the alpha
  float n = (h2(gl_FragCoord.xy + fract(tt) * 13.0) + h2(gl_FragCoord.xy * 1.7 + fract(tt * 0.7) * 29.0) - 1.0) / 255.0;
  vec3 enc = pow(max(brand * a, 0.0), vec3(1.0 / 2.2)) + n;
  o = vec4(enc, a + n);
}`;

function init(cv) {
  canvas = cv;
  gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) { postMessage({ type: 'nogl' }); return; }
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  uT = gl.getUniformLocation(prog, 't'); uRes = gl.getUniformLocation(prog, 'res'); uRamp = gl.getUniformLocation(prog, 'ramp'); uCalm = gl.getUniformLocation(prog, 'calm');
  t0 = performance.now();
  frame();
}
let frames = 0;
function frame() {
  const t = (performance.now() - t0) / 1000;
  const r = Math.min(1, t / 1.5); const ease = r * r * (3 - 2 * r);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1f(uT, t); gl.uniform2f(uRes, canvas.width, canvas.height); gl.uniform1f(uRamp, ease); gl.uniform1f(uCalm, calm);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  frames++;
  raf = requestAnimationFrame(frame);
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { calm = m.calm ?? 1; try { init(m.canvas); } catch (err) { postMessage({ type: 'nogl', err: String(err) }); } }
  else if (m.type === 'size' && canvas) { canvas.width = m.w; canvas.height = m.h; }
  else if (m.type === 'frames') postMessage({ type: 'frames', n: frames });
  else if (m.type === 'pix' && gl) {   // harness: alpha/rgb stats of a few rows, read straight from the GL framebuffer
    const W = canvas.width, H = canvas.height, rows = [0.03, 0.15, 0.35, 0.6].map((f) => Math.floor(f * H)), out = {};
    for (const y of rows) { const px = new Uint8Array(W * 4); gl.readPixels(0, y, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let maxA = 0, sumA = 0, maxG = 0; for (let i = 0; i < W; i++) { const a = px[i * 4 + 3]; sumA += a; if (a > maxA) maxA = a; if (px[i * 4 + 1] > maxG) maxG = px[i * 4 + 1]; }
      out[`y=${(y / H).toFixed(2)}`] = { maxA, meanA: +(sumA / W).toFixed(1), maxG }; }
    postMessage({ type: 'pix', size: [W, H], t: (performance.now() - t0) / 1000, ...out });
  }
  else if (m.type === 'stop') { cancelAnimationFrame(raf); close(); }
};
