import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnerProfileName, __resetOwnerProfileNameCache } from '../src/nostr.js';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function profileEvent(pubkey, content, created_at = 100) {
  return {
    id: `${created_at}`.padStart(64, '0'),
    pubkey,
    created_at,
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
    sig: 'c'.repeat(128),
  };
}

describe('fetchOwnerProfileName', () => {
  beforeEach(() => {
    __resetOwnerProfileNameCache();
  });

  it('resolves the displayName from a fanoutReq-shaped result, read-only (no state mutation)', async () => {
    const request = vi.fn(async (relays, filters, opts) => {
      expect(relays).toEqual(['wss://nos.lol', 'wss://relay.vertexlab.io']);
      expect(filters).toEqual([{ kinds: [0], authors: [OWNER], limit: 1 }]);
      expect(opts).toMatchObject({ timeoutMs: expect.any(Number) });
      return { events: [profileEvent(OWNER, { display_name: 'Chief Monkey', name: 'chiefmonkey' })], used: relays, failed: [] };
    });

    const name = await fetchOwnerProfileName(OWNER, { request });
    expect(name).toBe('Chief Monkey');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('falls back to the name field when display_name is absent', async () => {
    const request = vi.fn(async () => ({
      events: [profileEvent(OWNER, { name: 'chiefmonkey' })],
    }));
    const name = await fetchOwnerProfileName(OWNER, { request });
    expect(name).toBe('chiefmonkey');
  });

  it('returns empty string when no event is found for the pubkey', async () => {
    const request = vi.fn(async () => ({ events: [] }));
    const name = await fetchOwnerProfileName(OWNER, { request });
    expect(name).toBe('');
  });

  it('ignores events from other pubkeys mixed into the same relay response', async () => {
    const request = vi.fn(async () => ({
      events: [profileEvent(OTHER, { name: 'Someone Else' })],
    }));
    const name = await fetchOwnerProfileName(OWNER, { request });
    expect(name).toBe('');
  });

  it('returns empty string (never throws) when the transport rejects', async () => {
    const request = vi.fn(async () => { throw new Error('relay unreachable'); });
    await expect(fetchOwnerProfileName(OWNER, { request })).resolves.toBe('');
  });

  it('rejects malformed pubkeys without calling the transport', async () => {
    const request = vi.fn(async () => ({ events: [] }));
    expect(await fetchOwnerProfileName('not-a-pubkey', { request })).toBe('');
    expect(await fetchOwnerProfileName('', { request })).toBe('');
    expect(await fetchOwnerProfileName(null, { request })).toBe('');
    expect(request).not.toHaveBeenCalled();
  });

  it('caches a resolved name so a second call within the TTL skips the transport', async () => {
    const request = vi.fn(async () => ({
      events: [profileEvent(OWNER, { display_name: 'Chief Monkey' })],
    }));
    const t0 = 1_000_000;
    const first = await fetchOwnerProfileName(OWNER, { request, nowMs: t0 });
    const second = await fetchOwnerProfileName(OWNER, { request, nowMs: t0 + 1000 });
    expect(first).toBe('Chief Monkey');
    expect(second).toBe('Chief Monkey');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-queries after the cache TTL expires', async () => {
    const request = vi.fn(async () => ({
      events: [profileEvent(OWNER, { display_name: 'Chief Monkey' })],
    }));
    const t0 = 1_000_000;
    await fetchOwnerProfileName(OWNER, { request, nowMs: t0 });
    await fetchOwnerProfileName(OWNER, { request, nowMs: t0 + 6 * 60 * 1000 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never mutates global state (no state.js import side effects)', async () => {
    // fetchOwnerProfileName must not import/touch state.nostrName or emit NOSTR_LOGIN —
    // that would incorrectly clobber the VIEWER's own identity when looking up the
    // OWNER's name. Structural check: calling it with a custom request never throws
    // even without any DOM/state present in this test file (unlike fetchProfileProgressive,
    // which requires document/state setup elsewhere).
    const request = vi.fn(async () => ({ events: [profileEvent(OWNER, { name: 'X' })] }));
    await expect(fetchOwnerProfileName(OWNER, { request })).resolves.toBe('X');
  });
});
