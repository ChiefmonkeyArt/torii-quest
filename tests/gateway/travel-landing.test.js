// v0.2.935 — land first, grow grass after. The arrival card, the gate window closing
// and the hand-over all fire the moment the player lands, not after ~7 s of foliage.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../src/arenaRuntime.js', import.meta.url), 'utf8');
const fn = (name) => {
  const i = SRC.indexOf(`function ${name}(`);
  expect(i, name).toBeGreaterThan(-1);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i));
};

describe('travel lands before the foliage', () => {
  it('island builder: respawn → landed → foliage (mirror, greeter, portal before landing)', () => {
    const b = fn('_buildStarterIsland');
    const at = (s) => { const k = b.indexOf(s); expect(k, s).toBeGreaterThan(-1); return k; };
    expect(at('resetPlayerPos()')).toBeLessThan(at('_fireLanded()'));
    expect(at('_fireLanded()')).toBeLessThan(at('await _islandFoliage(plan)'));
    for (const s of ['_islandMirror(plan)', '_islandNpc(plan)', '_islandPortal()']) expect(at(s)).toBeLessThan(at('_fireLanded()'));
  });
  it('the landed hook is one-shot and only fires on success', () => {
    const f = fn('_fireLanded');
    expect(f).toMatch(/const h = _landedHook;\n\s+_landedHook = null;/);
    const t = fn('travelToWorld');
    expect(t).toMatch(/if \(rebuilt && rebuilt\.ok === false\) \{ _landedHook = null; throw/);
    expect(t).toMatch(/catch \(e\) \{\n\s+_landedHook = null;/);
    expect(t).toMatch(/closeLiveMirror\(\);\n\s+if \(opts && typeof opts\.onLanded === 'function'\) opts\.onLanded\(\);/);
    const h = fn('returnHome');
    expect(h).toMatch(/_landedHook = \(\) => showArrivalCard\(\{ kind: 'home' \}\);/);
    expect(h).toMatch(/catch \(e\) \{ _landedHook = null; throw e; \}\n\s+_fireLanded\(\);/);
  });
  it('入 passes the arrival card as onLanded', () => {
    const c = fn('commitPeek');
    expect(c).toMatch(/const onLanded = \(\) => showArrivalCard\(\{ kind: 'arrive', owner: ownerLabel, world: world\.id \|\| '', npub \}\);/);
    expect(c).toMatch(/travelToWorld\(world, \{ wsEndpoint, ownerLabel, onLanded \}\)/);
  });
});
