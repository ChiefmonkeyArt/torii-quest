// tests/upgrade-in-place.test.js — coverage for the UPD-1 client-side upgrade
// primitive (v0.2.361-alpha). Every browser I/O dependency is injected, so the
// tests never touch a real service worker, cache backend, or `location`.
//
// Contract asserted:
//   1) missing / malformed adapter → soft failure, ok:false, no throw
//   2) all steps present + happy → ok:true, all step ok flags true, reload called
//   3) SW unregister throws → SW step ok:false, other steps still run, ok:true
//   4) clearCaches throws → CACHES step ok:false, reload still called, ok:true
//   5) reload throws → RELOAD step ok:false, ok summary is false
//   6) missing optional steps → those steps ok:false with "not supported"
//   7) browserUpgradeAdapter: pure at import, reads window at CALL time

import { describe, it, expect, vi } from 'vitest';
import {
  UPGRADE_STEP, runUpgradeInPlace, browserUpgradeAdapter,
} from '../src/engine/update/upgradeInPlace.js';

// A minimal adapter factory the individual tests specialise. Every method is a
// spy so we can assert call order + count.
function makeAdapter(overrides = {}) {
  return {
    unregisterServiceWorkers: vi.fn(async () => 2),
    clearCaches: vi.fn(async () => 3),
    reload: vi.fn(),
    ...overrides,
  };
}

describe('runUpgradeInPlace — adapter guarding', () => {
  it('no adapter → ok:false with a RELOAD-step descriptor, never throws', async () => {
    const r = await runUpgradeInPlace();
    expect(r.ok).toBe(false);
    expect(r.steps.length).toBe(1);
    expect(r.steps[0].step).toBe(UPGRADE_STEP.RELOAD);
    expect(r.steps[0].ok).toBe(false);
  });
  it('adapter without reload fn → same soft-fail descriptor', async () => {
    const r = await runUpgradeInPlace({ adapter: { unregisterServiceWorkers: async () => 0 } });
    expect(r.ok).toBe(false);
    expect(r.steps[0].step).toBe(UPGRADE_STEP.RELOAD);
    expect(r.steps[0].ok).toBe(false);
  });
  it('non-object adapter (e.g. number, null) → soft fail', async () => {
    const r1 = await runUpgradeInPlace({ adapter: 42 });
    const r2 = await runUpgradeInPlace({ adapter: null });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });
});

describe('runUpgradeInPlace — happy path', () => {
  it('runs SW → caches → reload in order and reports ok:true', async () => {
    const order = [];
    const adapter = makeAdapter({
      unregisterServiceWorkers: vi.fn(async () => { order.push('sw'); return 2; }),
      clearCaches:              vi.fn(async () => { order.push('caches'); return 3; }),
      reload:                   vi.fn(() => { order.push('reload'); }),
    });
    const r = await runUpgradeInPlace({ adapter });
    expect(r.ok).toBe(true);
    expect(order).toEqual(['sw', 'caches', 'reload']);
    expect(r.steps.map(s => s.step)).toEqual([
      UPGRADE_STEP.SW_UNREGISTER, UPGRADE_STEP.CACHES_CLEAR, UPGRADE_STEP.RELOAD,
    ]);
    expect(r.steps.every(s => s.ok)).toBe(true);
    expect(r.steps[0].detail).toBe(2);
    expect(r.steps[1].detail).toBe(3);
    expect(adapter.reload).toHaveBeenCalledTimes(1);
  });
});

describe('runUpgradeInPlace — individual step failures', () => {
  it('SW unregister throws → step ok:false but caches + reload still run', async () => {
    const adapter = makeAdapter({
      unregisterServiceWorkers: vi.fn(async () => { throw new Error('sw denied'); }),
    });
    const r = await runUpgradeInPlace({ adapter });
    expect(r.ok).toBe(true); // reload succeeded
    expect(r.steps[0]).toMatchObject({ step: UPGRADE_STEP.SW_UNREGISTER, ok: false });
    expect(r.steps[0].detail).toContain('sw denied');
    expect(r.steps[1].ok).toBe(true);
    expect(r.steps[2].ok).toBe(true);
    expect(adapter.clearCaches).toHaveBeenCalledTimes(1);
    expect(adapter.reload).toHaveBeenCalledTimes(1);
  });
  it('clearCaches throws → step ok:false but reload still runs', async () => {
    const adapter = makeAdapter({
      clearCaches: vi.fn(async () => { throw new Error('caches denied'); }),
    });
    const r = await runUpgradeInPlace({ adapter });
    expect(r.ok).toBe(true);
    expect(r.steps[1]).toMatchObject({ step: UPGRADE_STEP.CACHES_CLEAR, ok: false });
    expect(r.steps[1].detail).toContain('caches denied');
    expect(adapter.reload).toHaveBeenCalledTimes(1);
  });
  it('reload throws → summary ok:false, other steps preserved', async () => {
    const adapter = makeAdapter({
      reload: vi.fn(() => { throw new Error('nav blocked'); }),
    });
    const r = await runUpgradeInPlace({ adapter });
    expect(r.ok).toBe(false);
    expect(r.steps[2]).toMatchObject({ step: UPGRADE_STEP.RELOAD, ok: false });
    expect(r.steps[2].detail).toContain('nav blocked');
    // Previous best-effort steps still counted as ok.
    expect(r.steps[0].ok).toBe(true);
    expect(r.steps[1].ok).toBe(true);
  });
  it('missing optional steps → "not supported" without throwing', async () => {
    const adapter = { reload: vi.fn() };
    const r = await runUpgradeInPlace({ adapter });
    expect(r.ok).toBe(true);
    expect(r.steps[0]).toMatchObject({ step: UPGRADE_STEP.SW_UNREGISTER, ok: false, detail: 'not supported' });
    expect(r.steps[1]).toMatchObject({ step: UPGRADE_STEP.CACHES_CLEAR, ok: false, detail: 'not supported' });
    expect(r.steps[2].ok).toBe(true);
    expect(adapter.reload).toHaveBeenCalledTimes(1);
  });
});

describe('browserUpgradeAdapter', () => {
  it('is a pure factory: reads window at call time, not at import', () => {
    // If it were touching a real global at import, importing this test file
    // would have already thrown in a non-DOM env. Node vitest without jsdom
    // has no `window` — this line proving reachable is proof of purity.
    expect(typeof browserUpgradeAdapter).toBe('function');
  });
  it('given a mock window with SW + caches, reads and delegates correctly', async () => {
    const unregister = vi.fn(async () => true);
    const del = vi.fn(async () => true);
    const reload = vi.fn();
    const win = {
      navigator: { serviceWorker: { getRegistrations: async () => [{ unregister }, { unregister }] } },
      caches: { keys: async () => ['k1', 'k2', 'k3'], delete: del },
      location: { reload },
    };
    const a = browserUpgradeAdapter(win);
    await expect(a.unregisterServiceWorkers()).resolves.toBe(2);
    expect(unregister).toHaveBeenCalledTimes(2);
    await expect(a.clearCaches()).resolves.toBe(3);
    expect(del).toHaveBeenCalledTimes(3);
    a.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('missing SW / caches surfaces → returns 0 without throwing', async () => {
    const a = browserUpgradeAdapter({ navigator: {}, location: { reload: () => {} } });
    await expect(a.unregisterServiceWorkers()).resolves.toBe(0);
    await expect(a.clearCaches()).resolves.toBe(0);
  });
  it('missing location.reload → throws (only case allowed to throw)', () => {
    const a = browserUpgradeAdapter({});
    expect(() => a.reload()).toThrow(/location\.reload unavailable/);
  });
  it('individual SW unregister that throws is swallowed; count reflects successes', async () => {
    const win = {
      navigator: { serviceWorker: { getRegistrations: async () => [
        { unregister: async () => true },
        { unregister: async () => { throw new Error('denied'); } },
        { unregister: async () => true },
      ] } },
    };
    const a = browserUpgradeAdapter(win);
    await expect(a.unregisterServiceWorkers()).resolves.toBe(2);
  });
});
