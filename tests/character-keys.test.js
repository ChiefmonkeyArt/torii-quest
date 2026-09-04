import { describe, it, expect } from 'vitest';
import { VALID_CHARACTERS, isValidCharacterKey } from '../server/auth/characterKeys.js';

// v0.2.760-alpha — the server-side character whitelist must stay in lockstep
// with the client: 'guest' is the new anonymous default (guest-first title
// screen), the legacy presets remain valid, and a Character-Forge mesh hash is
// still an accepted peer identity.
describe('server character-key whitelist (v0.2.760)', () => {
  it('accepts guest as the anonymous default', () => {
    expect(VALID_CHARACTERS.has('guest')).toBe(true);
    expect(isValidCharacterKey('guest')).toBe(true);
  });

  it('accepts the legacy presets', () => {
    expect(isValidCharacterKey('chiefmonkey')).toBe(true);
    expect(isValidCharacterKey('nostrich')).toBe(true);
  });

  it('accepts a 64-hex Character-Forge mesh hash', () => {
    expect(isValidCharacterKey('a'.repeat(64))).toBe(true);
  });

  it('rejects unknown keys and non-strings', () => {
    expect(isValidCharacterKey('unknown')).toBe(false);
    expect(isValidCharacterKey('')).toBe(false);
    expect(isValidCharacterKey(undefined)).toBe(false);
    expect(isValidCharacterKey(null)).toBe(false);
  });

  it('rejects a short (non-64) hash string', () => {
    expect(isValidCharacterKey('a'.repeat(63))).toBe(false);
    expect(isValidCharacterKey('A'.repeat(64))).toBe(false);
  });
});