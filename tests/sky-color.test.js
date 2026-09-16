// sky-color.test.js — locks resolveSkyColor: the mirror paints a real background
// from the manifest sky colour instead of a black void (two-node playtest fix).
import { describe, it, expect } from 'vitest';
import { resolveSkyColor } from '../src/engine/world/skyColor.js';

describe('resolveSkyColor', () => {
  it('returns a numeric hex for a #rrggbb sky colour', () => {
    expect(resolveSkyColor({ sky: { color: '#87ceeb' } })).toBe(0x87ceeb);
  });

  it('expands #rgb to #rrggbb', () => {
    expect(resolveSkyColor({ sky: { color: '#abc' } })).toBe(0xaabbcc);
  });

  it('accepts a bare hex without the leading #', () => {
    expect(resolveSkyColor({ sky: { color: '123456' } })).toBe(0x123456);
  });

  it('falls back to the default light blue when sky is absent', () => {
    expect(resolveSkyColor({})).toBe(0x87ceeb);
    expect(resolveSkyColor(undefined)).toBe(0x87ceeb);
    expect(resolveSkyColor({ sky: {} })).toBe(0x87ceeb);
  });

  it('falls back on a malformed colour string', () => {
    expect(resolveSkyColor({ sky: { color: 'not-a-colour' } })).toBe(0x87ceeb);
    expect(resolveSkyColor({ sky: { color: '' } })).toBe(0x87ceeb);
  });

  it('honours a custom fallback', () => {
    expect(resolveSkyColor({}, 0x000000)).toBe(0x000000);
    expect(resolveSkyColor({ sky: { color: 'zzz' } }, 0x112233)).toBe(0x112233);
  });
});