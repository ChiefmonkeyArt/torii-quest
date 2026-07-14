// tests/npub.test.js — NIP-19 npub → hex64 normaliser (npub.js, UPD-2, v0.2.387-alpha).
// The admin gate accepts QUEST_ADMIN_NPUB in either bech32 `npub1…` or raw hex64
// form; this asserts the decoder round-trips the canonical NIP-19 test vector,
// passes hex through (case-insensitive), and fails CLOSED (→ null) on every kind
// of malformed input so a bad config can never resolve to a live admin key.
import { describe, it, expect } from 'vitest';
import { npubToHex } from '../src/engine/crypto/npub.js';

// Canonical NIP-19 vector (from the spec examples).
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const HEX  = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';

describe('npubToHex', () => {
  it('decodes the canonical npub vector to its hex64 pubkey', () => {
    expect(npubToHex(NPUB)).toBe(HEX);
  });

  it('passes a raw hex64 through, lowercased and trimmed', () => {
    expect(npubToHex(HEX)).toBe(HEX);
    expect(npubToHex(HEX.toUpperCase())).toBe(HEX);
    expect(npubToHex(`  ${HEX}  `)).toBe(HEX);
  });

  it('returns null for a bad checksum', () => {
    // Flip the last data char → checksum no longer verifies.
    const broken = `${NPUB.slice(0, -1)}${NPUB.slice(-1) === 'g' ? 'q' : 'g'}`;
    expect(npubToHex(broken)).toBeNull();
  });

  it('returns null for the wrong hrp (nsec / other prefixes)', () => {
    expect(npubToHex('nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5')).toBeNull();
  });

  it('returns null for mixed-case bech32 (BIP-173)', () => {
    const mixed = `${NPUB.slice(0, 20).toUpperCase()}${NPUB.slice(20)}`;
    expect(npubToHex(mixed)).toBeNull();
  });

  it('returns null for non-strings, empty, and garbage', () => {
    expect(npubToHex(null)).toBeNull();
    expect(npubToHex(undefined)).toBeNull();
    expect(npubToHex(123)).toBeNull();
    expect(npubToHex('')).toBeNull();
    expect(npubToHex('npub1')).toBeNull();
    expect(npubToHex('not-a-key')).toBeNull();
    expect(npubToHex('deadbeef')).toBeNull(); // hex but not 64 chars
  });
});
