// tests/world-swap-combat-cleanup.test.js — an in-place world swap must leave no
// combat residue (the old P2 frozen-bullet/tracer glitch). Game Zone v2
// (ADR-0130) is hitscan — there are no projectiles — so the contract is: the
// rebuild calls gameZone.clear(), and clear() drops every bot view, prediction,
// tracer/spark and the boss bar. arenaRuntime is THREE/scene-bound, so the
// runtime half is a source contract; fx/reconciler behaviour is tested directly
// in tests/gamezone/*.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const GZ = readFileSync(new URL('../src/gamezone/client/gameZone.js', import.meta.url), 'utf8');
const RT = readFileSync(new URL('../src/arenaRuntime.js', import.meta.url), 'utf8');

describe('world swap clears the game zone', () => {
  it('gameZone.clear() drops views, predictions, fx and HUD combat state', () => {
    const fn = GZ.slice(GZ.indexOf('function clear()'), GZ.indexOf('function clear()') + 200);
    expect(fn).toContain('_clearViews()');
    expect(fn).toContain('pending.clear()');
    expect(fn).toContain('fx.clear()');
    expect(fn).toContain('hideBossBar()');
  });

  it('calls it during the in-place world teardown', () => {
    const rebuild = RT.slice(RT.indexOf('async function _rebuildWorldInPlace'));
    expect(rebuild).toContain('try { if (_gz) _gz.clear(); } catch { /* noop */ }');
  });

  it('the legacy projectile path is gone', () => {
    expect(RT).not.toContain('clearActiveBullets');
    expect(RT).not.toContain("from './weapons.js'");
    expect(RT).not.toContain("from './bots.js'");
  });
});
