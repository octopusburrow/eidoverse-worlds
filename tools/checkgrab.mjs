// checkgrab — report the vrgrab1 entity's existence/position/components.
//
// 2026-08-23: migrated onto probe-join's openWorld. The previous version was 11 lines
// that hardcoded the URL, slept a blind 15s, and read the entity with no join proof at
// all. If the door had rejected it, it printed {"exists":false} — which reads as "the
// object isn't there", not "I never got into the world". That is the exact confusion
// openWorld exists to make impossible.
import { withWorld } from './probe-join.mjs';

const r = await withWorld({
  world: process.env.WORLD || 'workbench',
  name: 'grabcheck',
  key: process.env.KEY || 'workbench-2026',
  base: process.env.BASE || 'http://127.0.0.1:8940',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  requireContent: true,   // a grab check against an EMPTY world is meaningless
}, async ({ page }) => page.evaluate(async () => {
  const { comps, entities } = await import('/lib/world.js');
  const o = entities.get('vrgrab1');
  return {
    exists: !!o,
    pos: o?.position?.toArray?.().map((n) => +n.toFixed(2)),
    comps: comps.get('vrgrab1') ?? null,
  };
}));

console.log(JSON.stringify(r));
