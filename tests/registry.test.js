// tests/registry.test.js — locks the component loader/registry (CMP-7,
// src/engine/components/registry.js). Pure module → node-testable, no
// scene/Rapier/Nostr. We assert: register validates + indexes by id/kind, load
// returns a fresh contract-valid instance, unknown/invalid loads degrade safely,
// duplicate registration is rejected, and the built-in registry carries the
// shipped reference components. Crucially: no remote/dynamic code path exists.
import { describe, it, expect } from 'vitest';
import {
  createRegistry, createBuiltinRegistry, builtinRegistry,
} from '../src/engine/components/registry.js';
import { createToriiGateway } from '../src/engine/components/toriiGateway.js';
import { createProductDisplay } from '../src/engine/components/productDisplay.js';
import { isComponent } from '../src/engine/components/contract.js';
import * as SDK from '../src/sdk/index.js';

describe('registry — register + discovery', () => {
  it('registers a factory and indexes it by id and kind', () => {
    const reg = createRegistry();
    const id = reg.register(createToriiGateway);
    expect(id).toBe('torii.gateway');
    expect(reg.has('torii.gateway')).toBe(true);
    expect(reg.ids()).toContain('torii.gateway');
    expect(reg.kinds()).toContain('gateway');
    expect(reg.byKind('gateway')).toEqual(['torii.gateway']);
    expect(reg.size).toBe(1);
  });

  it('rejects a non-function factory', () => {
    const reg = createRegistry();
    expect(() => reg.register({})).toThrow();
  });

  it('rejects a factory that does not produce a component', () => {
    const reg = createRegistry();
    expect(() => reg.register(() => ({ nope: true }))).toThrow();
  });

  it('rejects a duplicate id', () => {
    const reg = createRegistry();
    reg.register(createToriiGateway);
    expect(() => reg.register(createToriiGateway)).toThrow(/duplicate/);
  });
});

describe('registry — load', () => {
  it('loads a fresh contract-valid instance and forwards config', () => {
    const reg = createRegistry();
    reg.register(createToriiGateway);
    const res = reg.load('torii.gateway', { npub: 'npub1dest', target: 'zone-7' });
    expect(res.ok).toBe(true);
    expect(isComponent(res.component)).toBe(true);
    expect(res.manifest.gateway.target).toBe('zone-7');
    expect(res.manifest.author.npub).toBe('npub1dest');
  });

  it('returns independent instances per load (separate mount state)', () => {
    const reg = createRegistry();
    reg.register(createToriiGateway);
    const a = reg.load('torii.gateway').component;
    const b = reg.load('torii.gateway').component;
    expect(a).not.toBe(b);
    a.mount({});
    expect(a.mounted).toBe(true);
    expect(b.mounted).toBe(false);
  });

  it('degrades safely on an unknown id (no throw)', () => {
    const reg = createRegistry();
    const res = reg.load('does.not.exist');
    expect(res.ok).toBe(false);
    expect(res.component).toBeNull();
    expect(res.errors[0]).toMatch(/unknown component id/);
  });

  it('flags an incompatible contract version', () => {
    const reg = createRegistry();
    // A factory whose component declares a future contract version.
    reg.register(() => ({
      manifest: {
        id: 'x.future', name: 'Future', version: '9.9.9',
        author: { npub: 'npub1future0aaaaaaaaaaaaaaaaaaaaaaa' },
        mountTarget: 'scene', kind: 'gateway', contract: '99.0.0',
      },
      mount() {}, unmount() {},
    }));
    const res = reg.load('x.future');
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/incompatible contract version/);
  });
});

describe('registry — built-in registry', () => {
  it('carries the shipped reference components', () => {
    const reg = createBuiltinRegistry();
    expect(reg.has('torii.gateway')).toBe(true);
    expect(reg.has('plebeian.product-display')).toBe(true);
    expect(reg.load('plebeian.product-display').ok).toBe(true);
  });

  it('default builtinRegistry instance is populated', () => {
    expect(builtinRegistry.size).toBeGreaterThanOrEqual(2);
  });
});

describe('registry — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.registry.createRegistry).toBe('function');
    expect(SDK.registry.builtinRegistry.has('torii.gateway')).toBe(true);
    expect(SDK.SDK_SURFACE.registry.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('registry');
  });
});
