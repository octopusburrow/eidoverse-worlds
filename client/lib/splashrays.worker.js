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
  float aspect = res.x / res.y;
  // BEAMS: light from a source below the frame. Everything is polar about it,
  // so shafts are narrow near the ground and widen as they rise — the
  // geometry of light scattering up, not a bell.
  vec2 src = vec2(0.5, -0.55);
  vec2 d = vec2((uv.x - src.x) * aspect, uv.y - src.y);
  float r = length(d);
  float ang = atan(d.x, d.y);                  // 0 = straight up
  float tt = t * calm;
  // many thin shafts of varying brightness: fbm over angle, drifting VISIBLY
  // (a full pattern period every ~12 s) plus a slower counter-drift layer
  float shafts = fbm1(ang * 9.0 + tt * 0.5) * 0.7 + fbm1(ang * 23.0 - tt * 0.31 + 7.0) * 0.3;
  shafts = pow(smoothstep(0.22, 1.0, shafts), 1.2);      // wide ramp: soft shaft edges
  // light TRAVELLING up the shafts: low-frequency noise scrolling along r
  float travel = 0.75 + 0.25 * n1(r * 6.0 - tt * 0.9 + ang * 3.0);
  // falloff with height (in uv, so it reads the same at every aspect)
  float fall = smoothstep(0.78, 0.0, uv.y); fall *= fall;
  // a soft haze so the beams sit in atmosphere rather than on black
  float haze = n2(vec2(uv.x * 3.0 + tt * 0.05, uv.y * 2.0 - tt * 0.08)) * 0.35 + 0.25;
  float beam = shafts * travel * fall;
  float glow = haze * fall * 0.35;
  vec3 brand = vec3(0.561, 0.910, 0.784), deep = vec3(0.22, 0.52, 0.47);
  vec3 col = mix(deep, brand, clamp(beam * 1.4, 0.0, 1.0));
  float a = clamp(beam * 0.24 + glow * 0.14, 0.0, 0.45) * ramp;
  // DITHER, properly: triangular-distributed noise (two hashes summed), ±1
  // level, applied in LINEAR light, then the value is encoded to sRGB — so the
  // dark end, where 8-bit steps are coarsest to the eye, gets the most help.
  float n = (h2(gl_FragCoord.xy + fract(tt) * 13.0) + h2(gl_FragCoord.xy * 1.7 + fract(tt * 0.7) * 29.0) - 1.0) / 255.0;
  vec3 lin = col * a;
  vec3 enc = pow(max(lin, 0.0), vec3(1.0 / 2.2)) + n;
  o = vec4(enc, a + n);                        // premultiplied
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
  else if (m.type === 'stop') { cancelAnimationFrame(raf); close(); }
};
