// kami-nostr-cap.test.js — ADR-0040 Stage 1. Browser NIP-07 feature detection.

import { describe, it, expect, beforeEach } from 'vitest';
import { hasNip07, hasNip04, hasNip44, summarize } from '../../src/engine/kami/kamiNostrCap.js';

beforeEach(() => { delete globalThis.window; });

describe('hasNip07 / hasNip04 / hasNip44', () => {
  it('returns false when window.nostr is absent', () => {
    expect(hasNip07()).toBe(false);
    expect(hasNip04()).toBe(false);
    expect(hasNip44()).toBe(false);
    expect(summarize().canDecryptNip17Dm).toBe(false);
  });

  it('detects nip07-only (getPublicKey + signEvent, no nip04/nip44)', () => {
    globalThis.window = { nostr: { getPublicKey: () => 'x', signEvent: async () => ({}) } };
    expect(hasNip07()).toBe(true);
    expect(hasNip04()).toBe(false);
    expect(hasNip44()).toBe(false);
    expect(summarize()).toMatchObject({ nip07: true, nip04: false, nip44: false, canDecryptNip17Dm: false });
  });

  it('detects nip04 (legacy DMs)', () => {
    globalThis.window = { nostr: { getPublicKey: () => 'x', signEvent: async () => ({}), encrypt: async () => '', decrypt: async () => '' } };
    expect(hasNip04()).toBe(true);
    expect(hasNip44()).toBe(false);
  });

  it('detects nip44 (the rare extension that can unwrap NIP-17 in-browser)', () => {
    globalThis.window = { nostr: { getPublicKey: () => 'x', signEvent: async () => ({}), nip44: { encrypt: async () => '', decrypt: async () => '' } } };
    expect(hasNip44()).toBe(true);
    expect(summarize().canDecryptNip17Dm).toBe(true);
  });

  it('ignores a non-object window.nostr', () => {
    globalThis.window = { nostr: 'not-an-object' };
    expect(hasNip07()).toBe(false);
  });
});
