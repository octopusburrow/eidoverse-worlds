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
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / res;           // (0,0) bottom-left
  vec3 brand = vec3(0.561, 0.910, 0.784);      // #8fe8c8
  vec3 deep  = vec3(0.30, 0.62, 0.55);
  float acc = 0.0; vec3 col = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float x0 = (fi + 0.5) / 12.0 + 0.02 * sin(fi * 2.3);
    float ws = (0.12 + 0.05 * mod(fi * 11.0, 4.0)) * calm;
    float x = x0 + sin(t * ws + fi * 1.31) * (0.02 + 0.012 * mod(fi * 3.0, 3.0));
    float w = 0.05 + 0.04 * mod(fi * 7.0, 4.0) / 3.0;
    float h = 0.45 + 0.25 * mod(fi * 5.0, 3.0) / 2.0;
    h *= 1.0 + 0.06 * sin(t * ws * 1.7 + fi);
    float dx = (uv.x - x) / w;
    float bell = exp(-dx * dx * 2.2);                       // soft sides, no seams
    float fall = smoothstep(h, 0.0, uv.y);                  // bright at the ground, gone at h
    fall *= fall;
    float a = bell * fall * (0.5 + 0.5 * mod(fi * 13.0, 3.0) / 2.0);
    col += mix(brand, deep, mod(fi, 2.0)) * a; acc += a;
  }
  float alpha = clamp(acc * 0.16, 0.0, 0.5) * ramp;
  vec3 rgb = acc > 0.0 ? col / acc : brand;
  // dither: +-0.5/255 of blue-ish noise before quantisation — this is what
  // Canvas2D could not do and why it banded
  float n = (hash(gl_FragCoord.xy + fract(t) * 17.0) - 0.5) / 255.0;
  o = vec4(rgb * alpha + n, alpha + n);      // premultiplied, canvas alpha:true
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
