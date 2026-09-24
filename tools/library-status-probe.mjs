// bun tools/library-status-probe.mjs — /library-models carries each entry's optimization status (opt.{min,ktx2,lod}),
// read from the sweep's markers. Uses an owned world server; asserts shape on every entry and that states are the
// documented set. Real counts depend on the host's store, so they are printed, not asserted.
import { ownedWorld, checker } from './probe-harness.mjs';
const { check, done } = checker();
const world = await ownedWorld({});
try {
  const r = await fetch(`${world.origin}/library-models`, { headers: { cookie: world.cookie ?? '' } });
  const hits = await r.json();
  const STATES = new Set(['built', 'not-needed', 'unsupported', 'refused', 'stale', 'deferred', 'pending']);
  // store/ entries have all three passes; library entries have no draco 'min' pass at all, so no min field
  const want = (h) => (h.path.startsWith('store/') ? ['min', 'ktx2', 'lod'] : ['ktx2', 'lod']);
  const bad = hits.filter((h) => !h.opt || !want(h).every((k) => STATES.has(h.opt[k]?.state) && ('reason' in h.opt[k]))
    || (!h.path.startsWith('store/') && 'min' in h.opt));
  const tally = {};
  for (const h of hits) for (const k of ['min', 'ktx2', 'lod']) { const s = h.opt?.[k]?.state; tally[`${k}:${s}`] = (tally[`${k}:${s}`] ?? 0) + 1; }
  console.log(`  ${hits.length} entries; ${JSON.stringify(tally)}`);
  check('every entry carries the opt fields its kind HAS (store: min/ktx2/lod; library: ktx2/lod, no phantom min)', r.ok && hits.length > 0 && bad.length === 0, bad.slice(0, 2));
  const refused = hits.filter((h) => ['refused', 'unsupported', 'stale', 'deferred'].includes(h.opt?.lod?.state));
  check('no refusal is silent: every non-built, non-pending LOD state has a non-empty reason', refused.every((h) => h.opt.lod.reason), refused.filter((h) => !h.opt.lod.reason).slice(0, 2));
} catch (e) { check('probe ran', false, String(e).slice(0, 300)); }
finally { await world.close(); }
done();
