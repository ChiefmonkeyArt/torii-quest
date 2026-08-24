// tests/napplets/world-napplet-handlers.test.js — nap-torii-world v0 dispatchers
// (ADR-0057). Pure: getSurfaceConfig + listSurfaces are injected stubs. No network,
// signing, wallet, or travel side effects.
import { describe, it, expect } from 'vitest';
import { createWorldHandlers } from '../../src/engine/napplets/worldNappletHandlers.js';
import {
  getWorldSurfaceConfig, listWorldSurfaces, WORLD_NAPPLET_SURFACE_CONFIG,
} from '../../src/engine/napplets/worldNappletSurfaceConfig.js';

function makeHandlers() {
  return createWorldHandlers({
    worldNpub: 'npub1shellhost',
    worldLabel: 'Cornish Torii',
    getSurfaceConfig: getWorldSurfaceConfig,
    listSurfaces: listWorldSurfaces,
  });
}

describe('world.attach.get', () => {
  it('returns the bound surface config + informational transform', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.attach.get', {}, 'product-stall-panel', 'r1');
    expect(out.type).toBe('world.attach.get.result');
    expect(out.id).toBe('r1');
    expect(out.result).toEqual({
      worldNpub: 'npub1shellhost',
      worldLabel: 'Cornish Torii',
      zoneId: 'nap',
      surfaceId: 'product-stall-panel',
      surfaceKind: 'panel',
      surfaceTransform: expect.any(Object),
    });
    expect(out.result.surfaceTransform.position).toHaveLength(3);
  });

  it('errors on an unknown surface id', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.attach.get', {}, 'no-such-surface', 'r2');
    expect(out.type).toBe('world.attach.get.error');
    expect(out.error.code).toBe('unknown-surface');
  });
});

describe('world.zone.list', () => {
  it('lists only safe surface metadata for the same zone', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.zone.list', {}, 'product-stall-panel', 'r3');
    expect(out.type).toBe('world.zone.list.result');
    expect(out.result.zoneId).toBe('nap');
    const ids = out.result.surfaces.map((s) => s.surfaceId);
    expect(ids).toContain('product-stall-panel');
    expect(ids).toContain('leaderboard-board');
    // No napplet identities leak — only surfaceId / surfaceKind / position.
    out.result.surfaces.forEach((s) => {
      expect(Object.keys(s).sort()).toEqual(['position', 'surfaceId', 'surfaceKind']);
    });
  });
});

describe('world.emit', () => {
  it('rejects an empty kind as unsupported', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.emit', {}, 'product-stall-panel', 'r4');
    expect(out.result).toEqual({ accepted: false, reason: 'unsupported-kind' });
  });

  it('rejects a kind not in the panel allow-list (wrong-surface)', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.emit', { kind: 'purchase' }, 'product-stall-panel', 'r5');
    expect(out.result.accepted).toBe(false);
    expect(out.result.reason).toBe('wrong-surface');
  });

  it('accepts an allowed kind as a no-op (no side effect, no signing)', () => {
    const { dispatch } = makeHandlers();
    const out = dispatch('world.emit', { kind: 'custom' }, 'product-stall-panel', 'r6');
    expect(out.result.accepted).toBe(true);
    expect(out.result.actionId).toBe('noop');
  });
});

describe('deferred actions', () => {
  it('returns an unsupported error for pose.subscribe, pose.unsubscribe, and visit', () => {
    const { dispatch } = makeHandlers();
    for (const t of ['world.pose.subscribe', 'world.pose.unsubscribe', 'world.visit']) {
      const out = dispatch(t, {}, 'product-stall-panel', 'r7');
      expect(out.type).toBe(`${t}.error`);
      expect(out.error.code).toBe('unsupported');
    }
  });
});

describe('forward-compat + namespace isolation', () => {
  it('silently ignores unknown world actions (returns null)', () => {
    const { dispatch } = makeHandlers();
    expect(dispatch('world.something.new', {}, 'product-stall-panel', 'r8')).toBeNull();
  });
  it('ignores messages outside the world namespace', () => {
    const { dispatch } = makeHandlers();
    expect(dispatch('game.host.info', {}, 'product-stall-panel', 'r9')).toBeNull();
    expect(dispatch('avatar.get', {}, 'product-stall-panel', 'rA')).toBeNull();
  });
});

describe('worldNappletSurfaceConfig', () => {
  it('keeps every surface disabled in v0 (test-only scaffold)', () => {
    expect(WORLD_NAPPLET_SURFACE_CONFIG.every((c) => c.enabled === false)).toBe(true);
  });
  it('derives surfaceKind from the proof surface id', () => {
    expect(getWorldSurfaceConfig('product-stall-panel').surfaceKind).toBe('panel');
    expect(getWorldSurfaceConfig('leaderboard-board').surfaceKind).toBe('panel');
  });
  it('returns null for an unknown surface id', () => {
    expect(getWorldSurfaceConfig('nope')).toBeNull();
  });
});
