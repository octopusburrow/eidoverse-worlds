// The XR pixel-ratio guard (client/lib/xrpixelratio.js, applied by core.js) — #32 split vision.
// While presenting, setPixelRatio is DEFERRED (the renderer keeps the XR layer's 1); not presenting, it
// applies untouched; the deferred value is handed back exactly once. tools/xr-eye-viewport-probe.mjs is
// the real-three half: it shows the ratio moving the right eye's viewport, and the guard stopping it.
import { guardPixelRatioInXR } from '../client/lib/xrpixelratio.js';
let pass = 0, fail = 0;
const check = (name, ok, note = '') => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${note ? `  -- ${note}` : ''}`); } };

class FakeRenderer {
  constructor() { this._pr = 1; this.calls = []; this.xr = { isPresenting: false }; }
  setPixelRatio(v = 1) { this.calls.push(v); this._pr = v; }
  getPixelRatio() { return this._pr; }
}
console.log('XR PIXEL-RATIO GUARD');
const r = new FakeRenderer();
const g = guardPixelRatioInXR(r);
check('installs and returns a handle', !!g && typeof g.takeDeferred === 'function');
check('installs once (a second call is refused)', guardPixelRatioInXR(r) === null);
check('refuses no renderer', guardPixelRatioInXR(null) === null);

r.setPixelRatio(1.5);
check('not presenting: applies untouched', r.getPixelRatio() === 1.5 && r.calls.at(-1) === 1.5);
r.setPixelRatio();
check('not presenting: the default argument still means 1', r.getPixelRatio() === 1);

r.xr.isPresenting = true;
const before = r.calls.length;
r.setPixelRatio(0.75);   // the governor's first shed on a dpr-1 monitor: the #32 value
check('presenting: the renderer is NOT touched (the eyes keep ratio 1)', r.getPixelRatio() === 1 && r.calls.length === before, `pr=${r.getPixelRatio()}`);
check('presenting: the value is deferred', g.deferred === 0.75);
r.setPixelRatio(0.875);  // the governor's restore step, also a corrupting value
check('presenting: the LAST ask wins', g.deferred === 0.875 && r.getPixelRatio() === 1);

r.xr.isPresenting = false;
check('takeDeferred hands the value back once', g.takeDeferred() === 0.875 && g.takeDeferred() === null);
r.setPixelRatio(2);
check('after exit: applies again', r.getPixelRatio() === 2);

const r2 = new FakeRenderer(); r2.xr = undefined; guardPixelRatioInXR(r2); r2.setPixelRatio(1.25);
check('a renderer without xr applies (never throws)', r2.getPixelRatio() === 1.25);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
