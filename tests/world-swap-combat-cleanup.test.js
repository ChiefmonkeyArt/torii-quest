// tests/world-swap-combat-cleanup.test.js — locks the P2 glitch-sweep fix that
// retracts in-flight projectiles/tracers on an in-place world swap. Weapons.js and
// arenaRuntime.js are THREE/scene-bound (not unit-importable), so — consistent with
// the other arena-bound regressions — this locks the contract at the source level.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const WEAPONS = readFileSync(new URL('../src/weapons.js', import.meta.url), 'utf8');
const RT = readFileSync(new URL('../src/arenaRuntime.js', import.meta.url), 'utf8');

describe('world swap retracts in-flight projectiles/tracers', () => {
  it('exposes a clearActiveBullets export', () => {
    expect(WEAPONS).toMatch(/export function clearActiveBullets\(\)/);
  });

  it('clears every active bullet back into the pool', () => {
    const fn = WEAPONS.slice(WEAPONS.indexOf('export function clearActiveBullets'));
    expect(fn).toContain('for (let i = _active.length - 1; i >= 0; i--)');
    expect(fn).toContain('scene.remove(b.mesh)');
    expect(fn).toContain('_pool.push(b)');
    expect(fn).toContain('_active.pop()');
  });

  it('finalises any pending player-shot diagnostic before clearing', () => {
    const fn = WEAPONS.slice(WEAPONS.indexOf('export function clearActiveBullets'));
    expect(fn).toContain('_finalizeShot(b, \'none\', false, null, Infinity)');
  });

  it('imports clearActiveBullets into the runtime', () => {
    expect(RT).toContain('clearActiveBullets');
  });

  it('calls it during the in-place world teardown', () => {
    const rebuild = RT.slice(RT.indexOf('async function _rebuildWorldInPlace'));
    expect(rebuild).toContain('try { clearActiveBullets(); } catch { /* noop */ }');
  });
});