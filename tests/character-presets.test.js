// tests/character-presets.test.js — locks the curated Character Forge presets
// (src/engine/character/characterPresets.js): the preset catalogue, the id
// lookup, and the preset→manifest builder (which must produce a valid
// `torii.character` manifest). Pure module → fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  CHARACTER_PRESETS, getCharacterPreset, presetToManifest,
} from '../src/engine/character/characterPresets.js';
import { validateCharacterManifest } from '../src/engine/character/characterManifest.js';
import * as SDK from '../src/sdk/index.js';

describe('CHARACTER_PRESETS', () => {
  it('ships the curated bases with content-addressed mesh hashes', () => {
    expect(CHARACTER_PRESETS.length).toBeGreaterThanOrEqual(2);
    const ids = CHARACTER_PRESETS.map((p) => p.id);
    expect(ids).toContain('chiefmonkey');
    expect(ids).toContain('nostrich');
    for (const p of CHARACTER_PRESETS) {
      expect(p.mesh.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(p.mesh.name.length).toBeGreaterThan(0);
    }
  });
});

describe('getCharacterPreset', () => {
  it('returns a preset by id and null for unknown ids', () => {
    expect(getCharacterPreset('chiefmonkey').label).toBe('Chiefmonkey');
    expect(getCharacterPreset('nostrich').label).toBe('Nostrich');
    expect(getCharacterPreset('nope')).toBe(null);
    expect(getCharacterPreset(undefined)).toBe(null);
  });
});

describe('presetToManifest', () => {
  it('builds a valid v1 manifest from a preset', () => {
    const manifest = presetToManifest(getCharacterPreset('chiefmonkey'));
    const { valid, errors } = validateCharacterManifest(manifest);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
    expect(manifest.mesh.hash).toBe(getCharacterPreset('chiefmonkey').mesh.hash);
    expect(manifest.name).toBe('Chiefmonkey');
    expect(manifest.clips).toEqual([]);
    expect(manifest.contrib).toEqual([]);
  });

  it('copies stickers/colors through when a preset carries them', () => {
    const manifest = presetToManifest({
      id: 'x', label: 'X',
      mesh: { hash: 'a'.repeat(64), name: 'x.glb' },
      name: 'X',
      colors: [{ slot: 'skin', hex: '#ff8800' }],
      stickers: [{ hash: 'b'.repeat(64), zoneId: 'chest', u: 0.5, v: 0.5, rot: 0 }],
    });
    expect(manifest.colors).toEqual([{ slot: 'skin', hex: '#ff8800' }]);
    expect(manifest.stickers[0].zoneId).toBe('chest');
  });

  it('degrades to an empty-shaped manifest on bad input', () => {
    const m = presetToManifest(null);
    expect(m.version).toBe(1);
    expect(m.mesh).toBe(null);
    expect(m.name).toBe('');
  });
});

describe('SDK exposure', () => {
  it('re-exports characterPresets at the experimental tier', () => {
    expect(SDK.characterPresets.getCharacterPreset).toBe(getCharacterPreset);
    expect(SDK.SDK_SURFACE.characterPresets.tier).toBe('experimental');
  });
});
