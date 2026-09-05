// tests/character-manifest.test.js — locks the `torii.character` manifest
// schema + validator (src/engine/character/characterManifest.js). Pure module
// → fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  CHARACTER_MANIFEST_VERSION, validateCharacterManifest,
  emptyCharacterManifest, isSha256, isHexColor,
} from '../src/engine/character/characterManifest.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'a'.repeat(64);

const goodManifest = () => ({
  version: 1,
  mesh: { hash: SHA, name: 'chiefmonkey6' },
  clips: [{ hash: SHA, name: 'Idle_02' }],
  stickers: [{ hash: SHA, zoneId: 'chest', u: 0.5, v: 0.5, rot: 0 }],
  name: 'Chiefmonkey',
  colors: [{ slot: 'primary', hex: '#ff8800' }],
  contrib: [{ nappletDTag: 'forge-v1', aggregateHash: SHA, tags: ['mesh'] }],
});

describe('helpers', () => {
  it('validates sha256 and hex colors', () => {
    expect(isSha256(SHA)).toBe(true);
    expect(isSha256('abc')).toBe(false);
    expect(isSha256('g'.repeat(64))).toBe(false);
    expect(isHexColor('#ff8800')).toBe(true);
    expect(isHexColor('ff8800')).toBe(false);
    expect(isHexColor('#ff88')).toBe(false);
  });

  it('emptyCharacterManifest returns a valid-shaped empty manifest', () => {
    const m = emptyCharacterManifest();
    expect(m.version).toBe(CHARACTER_MANIFEST_VERSION);
    expect(m.mesh).toBe(null);
    expect(m.clips).toEqual([]);
    expect(m.stickers).toEqual([]);
  });
});

describe('validateCharacterManifest', () => {
  it('accepts a complete manifest', () => {
    const r = validateCharacterManifest(goodManifest());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects a non-object', () => {
    const r = validateCharacterManifest(null);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('requires a mesh', () => {
    const m = goodManifest();
    delete m.mesh;
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('mesh'))).toBe(true);
  });

  it('rejects a bad mesh hash', () => {
    const m = goodManifest();
    m.mesh.hash = 'not-a-hash';
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('mesh.hash'))).toBe(true);
  });

  // v0.2.767-alpha — optional headless FP-body variant hash. Absence is legal
  // (legacy manifests); presence must be a 64-hex sha256 like the mesh hash.
  it('accepts a valid mesh.headlessHash', () => {
    const m = goodManifest();
    m.mesh.headlessHash = 'b'.repeat(64);
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('accepts an absent mesh.headlessHash (legacy manifest)', () => {
    const m = goodManifest();
    expect('headlessHash' in m.mesh).toBe(false);
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(true);
  });

  it('rejects a bad mesh.headlessHash', () => {
    const m = goodManifest();
    m.mesh.headlessHash = 'not-a-hash';
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('mesh.headlessHash'))).toBe(true);
  });

  it('rejects a bad color hex', () => {
    const m = goodManifest();
    m.colors = [{ slot: 'primary', hex: 'orange' }];
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('hex'))).toBe(true);
  });

  it('rejects a sticker missing zoneId', () => {
    const m = goodManifest();
    m.stickers = [{ hash: SHA, u: 0.5, v: 0.5, rot: 0 }];
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('zoneId'))).toBe(true);
  });

  it('warns on a version mismatch without failing', () => {
    const m = goodManifest();
    m.version = 99;
    const r = validateCharacterManifest(m);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes('version'))).toBe(true);
  });
});

describe('SDK exposure', () => {
  it('re-exports characterManifest at the experimental tier', () => {
    expect(SDK.characterManifest.validateCharacterManifest).toBe(validateCharacterManifest);
    expect(SDK.SDK_SURFACE.characterManifest.tier).toBe('experimental');
  });
});
