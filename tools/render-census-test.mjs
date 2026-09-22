// renderCensus (client/lib/render.js): the [xr:rec] `renders` field must be interpretable under the very
// bug it exists to catch. On 2026-09-20 it read max=6131 with the loop at 60 fps and could not say who
// rendered, and `draws` was lifetime-cumulative read as per-frame. This drives the real wrapper against
// the stub renderer: a burst inside one tick keeps its caller; a take reports per-frame deltas, not totals.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import { plugin } from 'bun';
const HERE = import.meta.dir; const here = (p) => `${HERE}/${p.replace(/^\.\//, '')}`;
plugin({ name: 'core-stub', setup(build) {
  build.onResolve({ filter: /^\.\/core\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
  build.onResolve({ filter: /^\.\/base\.js$/ }, () => ({ path: here('./core-stub.mjs') }));
  build.onResolve({ filter: /^\.\/loadwork\.js$/ }, () => ({ path: here('./loadwork-stub.mjs') }));
} });

const { renderer } = await import('./core-stub.mjs');
// the stub's render() is inert; make info.render.calls count like three's does
renderer.render = () => { renderer.info.render.calls++; };
const { renderCensus, renderCensusTick, renderCensusTake, RENDER_BURST } = await import('../client/lib/render.js');

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };

// 1. a healthy cadence: 3 frames × 8 renders → max 8, drawsPerFrame 8, no burst
for (let f = 0; f < 3; f++) { for (let i = 0; i < 8; i++) renderer.render({}, {}); renderCensusTick(); }
let t = renderCensusTake();
check('healthy: max is per-frame', t.max === 8, `max=${t.max}`);
check('healthy: frames counted', t.frames === 3, `frames=${t.frames}`);
check('healthy: drawsPerFrame is a delta, not lifetime', t.drawsPerFrame === 8, `dpf=${t.drawsPerFrame} calls=${renderer.info.render.calls}`);
check('healthy: no burst', t.burst === null);

// 2. a burst: ~600 renders inside ONE tick, from a named caller
function mirrorSpin() { for (let i = 0; i < 600; i++) renderer.render({}, {}); }
mirrorSpin(); renderCensusTick();
t = renderCensusTake();
check('burst: max reports the spike', t.max === 600, `max=${t.max}`);
check('burst: captured', !!t.burst, JSON.stringify(t.burst));
check('burst: names the caller', !!t.burst && /mirrorSpin/.test(t.burst.stack), t.burst?.stack);
check('burst: fires at the threshold, once', !!t.burst && t.burst.frame === 3, `frame=${t.burst?.frame} RENDER_BURST=${RENDER_BURST}`);
check('burst: drawsPerFrame delta = 600 over 1 frame', t.drawsPerFrame === 600, `dpf=${t.drawsPerFrame}`);

// 3. take clears it: the next window is clean
for (let i = 0; i < 4; i++) renderer.render({}, {}); renderCensusTick();
t = renderCensusTake();
check('after take: burst cleared', t.burst === null);
check('after take: max is this window only', t.max === 4, `max=${t.max}`);

// 4. a take with NO frames ticked reports raw draws, not NaN/Infinity
for (let i = 0; i < 5; i++) renderer.render({}, {});
t = renderCensusTake();
check('no-frame window: finite', Number.isFinite(t.drawsPerFrame) && t.frames === 0, `dpf=${t.drawsPerFrame} frames=${t.frames}`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
