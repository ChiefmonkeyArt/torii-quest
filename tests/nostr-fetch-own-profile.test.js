// tests/nostr-fetch-own-profile.test.js — locks the v0.2.875 resilience fix:
// owner-profile enrichment (the directory's kind:0 displayName lookup) must fan
// out with the SAME graceMs + retry the live world fetch uses. A transient
// cold-start relay miss on the name-carrying relays otherwise yields an empty
// enrichment that pins a directory row to the serial for the whole scan.
import { describe, it, expect, vi } from 'vitest';
import { fetchOwnProfile } from '../src/nostr.js';

const OWNER = 'a'.repeat(64);

function profileEvent(pubkey, displayName) {
  return {
    id: '1'.padStart(64, '0'),
    pubkey,
    created_at: 100,
    kind: 0,
    tags: [],
    content: JSON.stringify({ display_name: displayName }),
    sig: 'c'.repeat(128),
  };
}

describe('fetchOwnProfile — enrichment fanout resilience (v0.2.875)', () => {
  it('forwards graceMs + retries to the relay request (parity with the world fetch)', async () => {
    let capturedOpts = null;
    const request = vi.fn(async (_relays, _filters, opts) => {
      capturedOpts = opts;
      return { events: [profileEvent(OWNER, 'BitcoinBekka')], used: _relays, failed: [] };
    });

    const profile = await fetchOwnProfile(OWNER, { request });

    expect(profile.displayName).toBe('BitcoinBekka');
    expect(capturedOpts).toMatchObject({ timeoutMs: expect.any(Number), graceMs: 250, retries: 1 });
  });

  it('allows an explicit override of graceMs/retries without losing the defaults', async () => {
    let capturedOpts = null;
    const request = vi.fn(async (_r, _f, opts) => {
      capturedOpts = opts;
      return { events: [profileEvent(OWNER, 'BitcoinBekka')] };
    });

    await fetchOwnProfile(OWNER, { request, graceMs: 500, retries: 2 });
    expect(capturedOpts.graceMs).toBe(500);
    expect(capturedOpts.retries).toBe(2);
  });

  it('still returns null on a genuinely empty union (no profile event anywhere)', async () => {
    const request = vi.fn(async () => ({ events: [], used: [], failed: [] }));
    await expect(fetchOwnProfile(OWNER, { request })).resolves.toBeNull();
  });
});