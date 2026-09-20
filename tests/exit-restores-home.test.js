// tests/exit-restores-home.test.js
//
// v0.2.868 — exit-restores-home: leaving a visited world returns to MY home.
//
// travelToWorld swaps _minimalWorld to a foreign manifest IN PLACE. Before this
// slice, Home → ENTER resumed the DESTINATION world (the swap was never unwound),
// so a returning player re-entered someone else's world instead of their own.
//
// The fix captures the home world at boot (_homeWorld/_homeWorldId/_homeSpawn) and
// rebuilds it on ENTER when the player has travelled away. This source-contract
// test locks that wiring so a refactor that drops the capture, the guard, or the
// ENTER restore fails the suite. The runtime is three-dependent and heavily
// stubbed in unit tests, so we assert on the source text (same approach as the
// ADR-0098 client-suspend-on-home suite) rather than driving a live scene.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_SRC = readFileSync(join(ROOT, 'src/arenaRuntime.js'), 'utf8');

// The factory's exported surface (last `return {` block) — used to assert the
// restore helper stays reachable through the runtime (even though enter() is the
// caller, the helper must exist and be wired, not deleted).
const factoryReturn = RUNTIME_SRC.slice(RUNTIME_SRC.lastIndexOf('return {'));

describe('v0.2.868 — exit-restores-home (source contract)', () => {
  it('captures the home world at boot (_homeWorld/_homeWorldId/_homeSpawn)', () => {
    // The three capture statements must live inside boot(), after buildMinimalWorld
    // has produced the home _worldRt (which carries the spawn).
    expect(RUNTIME_SRC).toMatch(/_homeWorld = _minimalWorld;/);
    expect(RUNTIME_SRC).toMatch(/_homeWorldId = _worldId;/);
    expect(RUNTIME_SRC).toMatch(/_homeSpawn = \(_worldRt && _worldRt\.spawn\)/);
  });

  it('derives _homeSpawn from the home world\'s own spawn (not a gate arrival)', () => {
    // The homecoming must land at the world's OWN login spawn, so _homeSpawn is a
    // shallow copy of _worldRt.spawn { x, z, yaw } — never resolveArrival.
    expect(RUNTIME_SRC).toContain('_homeSpawn = (_worldRt && _worldRt.spawn)');
    expect(RUNTIME_SRC).toContain('x: _worldRt.spawn.x, z: _worldRt.spawn.z, yaw: _worldRt.spawn.yaw');
  });

  it('defines _restoreHomeWorld with a travelled-away guard (object identity)', () => {
    expect(RUNTIME_SRC).toMatch(/async function _restoreHomeWorld\(\)/);
    // No-op unless we actually left home: minimal + a captured home + identity differs.
    expect(RUNTIME_SRC).toContain('if (!_minimal || !_homeWorld) return;');
    expect(RUNTIME_SRC).toContain('if (_minimalWorld === _homeWorld) return;');
    // The homecoming rebuilds the captured home via the shared swap, with the home
    // world id + the home's OWN spawn (not a gate arrival).
    expect(RUNTIME_SRC).toContain('await _rebuildWorldInPlace(_homeWorld, { worldId: _homeWorldId, arrival: _homeSpawn });');
  });

  it('captures _homeWasLegacy in the legacy boot branch (v0.2.879 P0.2)', () => {
    // A legacy home has no manifest; _homeWasLegacy records it so homecoming can
    // reload instead of silently no-op'ing.
    expect(RUNTIME_SRC).toContain('_homeWasLegacy = true;');
    expect(RUNTIME_SRC).toContain('let _homeWasLegacy = false;');
  });

  it('reloads (same URL) when a legacy home travelled into a minimal foreign world', () => {
    const src = RUNTIME_SRC;
    // The legacy-home guard must run BEFORE the minimal/no-home guard, and it must
    // reload the page (never rebuild in place — there is no manifest to rebuild).
    const idxReload = src.indexOf('_homeWasLegacy && _minimal');
    const idxNoop = src.indexOf('if (!_minimal || !_homeWorld) return;');
    expect(idxReload).toBeGreaterThan(-1);
    expect(idxNoop).toBeGreaterThan(-1);
    expect(idxReload).toBeLessThan(idxNoop);
    expect(src).toContain('window.location.reload()');
  });

  it('enter() is async and restores home before waking the client', () => {
    expect(RUNTIME_SRC).toMatch(/async function enter\(\)/);
    const body = RUNTIME_SRC.match(/async function enter\s*\(\s*\)\s*\{([\s\S]*?)\n\s{2}\}/);
    expect(body).not.toBeNull();
    const [, src] = body;
    // Restore must run BEFORE resumeFromTitle (the scene must be the home world
    // before the run resets + spawns into it).
    expect(src).toContain('await _restoreHomeWorld()');
    expect(src.indexOf('await _restoreHomeWorld()')).toBeLessThan(src.indexOf('resumeFromTitle()'));
    expect(src.indexOf('resumeFromTitle()')).toBeLessThan(src.indexOf('transition('));
  });

  it('travelToWorld and _restoreHomeWorld share ONE swap path (_rebuildWorldInPlace)', () => {
    // The shared helper is the single teardown+rebuild site: travel commits through
    // it (gate arrival) and the home restore reuses it (home spawn). One path means
    // a fix to the swap fixes both directions.
    expect(RUNTIME_SRC).toMatch(/async function _rebuildWorldInPlace\(world, \{ worldId = '', arrival = null \} = \{\}\)/);
    expect(RUNTIME_SRC).toContain('await _rebuildWorldInPlace(world, { worldId: world.id || \'\' });');
    expect(RUNTIME_SRC).toContain('await _rebuildWorldInPlace(_homeWorld, { worldId: _homeWorldId, arrival: _homeSpawn });');
  });

  it('the swap lands via resolveArrival for a traveller, but the commanded arrival otherwise', () => {
    // Default (travel) → resolveArrival gate; a homecoming passes _homeSpawn, which
    // overrides it. This is the one seam that makes a visitor land AT THE GATE but a
    // returning player land at their own spawn.
    expect(RUNTIME_SRC).toContain('const sp = arrival || resolveArrival(_minimalWorld);');
  });
});