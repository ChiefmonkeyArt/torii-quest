// tests/sdk.test.js — locks the public SDK entrypoint (src/sdk/index.js, ARS-5).
// The SDK is a curated surface map + metadata, not a runtime. We assert:
//   - it imports cleanly in a node env (no scene/WebGLRenderer transitive pull),
//   - SDK_VERSION tracks config.js VERSION,
//   - every SDK_SURFACE entry has a valid stability tier,
//   - every non-internal surface is actually re-exported (and internals are not),
//   - a few representative exports are wired through to the real modules.
import { describe, it, expect } from 'vitest';
import * as SDK from '../src/sdk/index.js';
import { VERSION } from '../src/config.js';

describe('SDK — metadata', () => {
  it('SDK_VERSION matches config.js VERSION', () => {
    expect(SDK.SDK_VERSION).toBe(VERSION);
  });

  it('exposes the three stability tiers', () => {
    expect(SDK.STABILITY).toEqual({
      STABLE: 'stable', EXPERIMENTAL: 'experimental', INTERNAL: 'internal',
    });
  });

  it('every SDK_SURFACE entry has a valid tier', () => {
    for (const [name, meta] of Object.entries(SDK.SDK_SURFACE)) {
      expect(SDK.STABILITY_TIERS.has(meta.tier), `${name} tier`).toBe(true);
    }
  });

  it('SDK_SURFACE and STABILITY are frozen', () => {
    expect(Object.isFrozen(SDK.SDK_SURFACE)).toBe(true);
    expect(Object.isFrozen(SDK.STABILITY)).toBe(true);
  });
});

describe('SDK — surface wiring', () => {
  it('every non-internal surface is re-exported as a namespace', () => {
    for (const [name, meta] of Object.entries(SDK.SDK_SURFACE)) {
      if (meta.tier === SDK.STABILITY.INTERNAL) {
        // forward-declared only: must NOT be a live export, must have no module
        expect(meta.module, `${name} internal has no module`).toBeNull();
        expect(SDK[name], `${name} internal not exported`).toBeUndefined();
      } else {
        expect(meta.module, `${name} has module path`).toBeTruthy();
        // raycastService is exported as named values, not a namespace bag:
        if (name === 'raycastService') {
          expect(typeof SDK.createRaycastService).toBe('function');
          expect(typeof SDK.raycastService).toBe('object');
        } else {
          expect(SDK[name], `${name} namespace exported`).toBeTruthy();
        }
      }
    }
  });

  it('surfacesByTier filters correctly', () => {
    const stable = SDK.surfacesByTier(SDK.STABILITY.STABLE);
    expect(stable).toContain('damage');
    expect(stable).toContain('aim');
    expect(stable).not.toContain('botAgent');
    expect(SDK.surfacesByTier(SDK.STABILITY.INTERNAL)).toContain('identity');
  });

  it('re-exports resolve to the real module functions', () => {
    // combat/damage
    expect(SDK.damage.shotDamage(true)).toBe(SDK.damage.HEADSHOT_DAMAGE);
    expect(SDK.damage.shotDamage(false)).toBe(SDK.damage.BODY_DAMAGE);
    // weapons/reloadPose — rest at the endpoints
    expect(SDK.reloadPose.reloadDip(0)).toBeCloseTo(0, 6);
    expect(SDK.reloadPose.reloadDip(1)).toBeCloseTo(0, 6);
    // physics/raycastService — missing impl degrades safely
    const svc = SDK.createRaycastService({});
    expect(svc.ray(0, 0, 0, 1, 0, 0, 10)).toBeNull();
    expect(svc.lineOfSight(0, 0, 0, 1, 0, 0)).toBe(true);
  });
});
