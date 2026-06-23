// tests/torii-gateway.test.js — locks the reference Torii gateway component
// (CMP-8 skeleton, src/engine/components/toriiGateway.js). It is built on the
// v0.2.132 component contract (defineComponent), so it must be contract-valid,
// carry a gateway manifest, and have a symmetric idempotent mount/unmount
// lifecycle. Pure module → node-testable, no scene/Rapier/Nostr needed.
import { describe, it, expect } from 'vitest';
import {
  createToriiGateway, toriiGateway, GATEWAY_VERSION,
} from '../src/engine/components/toriiGateway.js';
import { isComponent, validateManifest } from '../src/engine/components/contract.js';
import * as SDK from '../src/sdk/index.js';

describe('toriiGateway — contract validity', () => {
  it('the default instance satisfies the component contract', () => {
    expect(isComponent(toriiGateway)).toBe(true);
    expect(validateManifest(toriiGateway.manifest).valid).toBe(true);
  });
  it('declares a gateway manifest (kind + provenance npub + scene target)', () => {
    const m = toriiGateway.manifest;
    expect(m.kind).toBe('gateway');
    expect(m.id).toBe('torii.gateway');
    expect(m.mountTarget).toBe('scene');
    expect(typeof m.author.npub).toBe('string');
    expect(m.author.npub.length).toBeGreaterThan(0);
    expect(m.version).toBe(GATEWAY_VERSION);
  });
});

describe('createToriiGateway — config flows into the manifest', () => {
  it('carries the supplied npub / relay / target / position', () => {
    const g = createToriiGateway({
      npub: 'npub1dest', relay: 'wss://relay.example', target: 'zone-42',
      position: { x: 1, y: 2, z: 3 },
    });
    expect(g.manifest.author.npub).toBe('npub1dest');
    expect(g.manifest.gateway).toEqual({
      npub: 'npub1dest', relay: 'wss://relay.example', target: 'zone-42',
      position: { x: 1, y: 2, z: 3 },
    });
    expect(validateManifest(g.manifest).valid).toBe(true);
  });
});

describe('toriiGateway — symmetric idempotent lifecycle', () => {
  it('mount then unmount toggles the mounted flag and is idempotent', () => {
    const g = createToriiGateway();
    const scene = { tag: 'scene' };
    expect(g.mounted).toBe(false);
    expect(g.mount(scene, { position: { x: 5, y: 0, z: 5 } })).toBe(true);
    expect(g.mounted).toBe(true);
    expect(g.mount(scene)).toBe(false);   // already mounted → no-op
    expect(g.unmount()).toBe(true);
    expect(g.mounted).toBe(false);
    expect(g.unmount()).toBe(false);      // already down → no-op
  });
  it('tolerates a null scene (skeleton no-op mount)', () => {
    const g = createToriiGateway();
    expect(() => g.mount(null)).not.toThrow();
    expect(g.mounted).toBe(true);
    expect(g.unmount()).toBe(true);
  });
});

describe('toriiGateway — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.toriiGateway.createToriiGateway).toBe('function');
    expect(isComponent(SDK.toriiGateway.toriiGateway)).toBe(true);
    expect(SDK.SDK_SURFACE.toriiGateway.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('toriiGateway');
  });
});
