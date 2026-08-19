// tests/world-presence.test.js — locks the n2n world-presence layer (P0, v0.2.251).
// Proves buildPresenceEvent produces a correct unsigned kind-30078 record,
// fetchOnlineWorlds sanitises injected relay events via gatewayRead + filters our
// own world, and publishOurPresence signs + fanout-publishes via injected fakes
// (and blocks cleanly with no signer). Pure module + injected transports → node-safe.
import { describe, it, expect } from 'vitest';
import {
  buildPresenceEvent, fetchOnlineWorlds, publishOurPresence,
} from '../src/engine/gateway/worldPresence.js';
import { GATEWAY_KIND, GATEWAY_TOPIC, DEMO_GATEWAY_EVENTS } from '../src/engine/gateway/gatewayRead.js';

const PUB_A = 'b'.repeat(64);
const PUB_B = '9'.repeat(64);

describe('buildPresenceEvent', () => {
  it('builds a valid unsigned kind-30078 presence event', () => {
    const { ok, event, errors } = buildPresenceEvent({
      pubkey: PUB_A,
      zoneId: 'quest-torii',
      title: 'Torii Quest',
      zoneType: 'arena',
      website: 'https://chiefmonkey.art/quest',
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
      npub: 'npub1' + 'a'.repeat(56),
    });
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(event.kind).toBe(GATEWAY_KIND);
    expect(event.pubkey).toBe(PUB_A);
    expect(typeof event.created_at).toBe('number');
    // d tag = zone id, t tag = discovery topic.
    expect(event.tags).toContainEqual(['d', 'quest-torii']);
    expect(event.tags).toContainEqual(['t', GATEWAY_TOPIC]);
    expect(event.tags).toContainEqual(['zoneType', 'arena']);
    // content is JSON carrying the sanitised fields.
    const content = JSON.parse(event.content);
    expect(content.zoneId).toBe('quest-torii');
    expect(content.title).toBe('Torii Quest');
    expect(content.website).toBe('https://chiefmonkey.art/quest');
    expect(content.relays).toEqual(['wss://relay.damus.io/', 'wss://nos.lol/']);
    // relay tags mirror the content relays.
    expect(event.tags.some((t) => t[0] === 'relay' && t[1] === 'wss://relay.damus.io/')).toBe(true);
  });

  it('rejects a missing pubkey and missing zoneId', () => {
    const r = buildPresenceEvent({ zoneId: 'x' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('pubkey'))).toBe(true);
    const r2 = buildPresenceEvent({ pubkey: PUB_A });
    expect(r2.ok).toBe(false);
    expect(r2.errors.some((e) => e.includes('zoneId'))).toBe(true);
  });

  it('drops unsafe schemes (http website, non-ws relay) and keeps safe ones', () => {
    const { ok, event } = buildPresenceEvent({
      pubkey: PUB_A, zoneId: 'z',
      website: 'http://insecure.example.com',     // http → dropped (https only)
      relays: ['wss://relay.damus.io', 'ftp://bad.example.com', 'not a url'],
    });
    expect(ok).toBe(true);
    const content = JSON.parse(event.content);
    expect(content.website).toBeNull();
    expect(content.relays).toEqual(['wss://relay.damus.io/']);
  });

  it('rejects a malformed pubkey (not hex64)', () => {
    const r = buildPresenceEvent({ pubkey: 'not-hex', zoneId: 'z' });
    expect(r.ok).toBe(false);
  });
});

describe('fetchOnlineWorlds', () => {
  // A fake fanoutReq-shaped transport returning the deterministic demo events.
  function fakeRequest(events) {
    return async (relays, filters, opts) => ({ events, used: relays, failed: [] });
  }

  it('sanitises injected relay events into a worlds list', async () => {
    const r = await fetchOnlineWorlds({
      request: fakeRequest(DEMO_GATEWAY_EVENTS),
      relays: ['wss://relay.damus.io'],
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBeGreaterThan(0);
    expect(r.worlds.every((w) => typeof w.zoneId === 'string')).toBe(true);
    expect(r.used).toContain('wss://relay.damus.io/');
  });

  it('filters our own world out of the list by pubkey', async () => {
    // DEMO_GATEWAY_EVENTS includes a record from PUB_A; filtering PUB_A should
    // remove it (or any record sharing that pubkey).
    const rAll = await fetchOnlineWorlds({
      request: fakeRequest(DEMO_GATEWAY_EVENTS),
      relays: ['wss://relay.damus.io'],
    });
    const rFiltered = await fetchOnlineWorlds({
      request: fakeRequest(DEMO_GATEWAY_EVENTS),
      relays: ['wss://relay.damus.io'],
      ourPubkey: PUB_A,
    });
    expect(rFiltered.count).toBeLessThanOrEqual(rAll.count);
    expect(rFiltered.worlds.every((w) => w.pubkey !== PUB_A)).toBe(true);
  });

  it('errors cleanly when no request transport is injected', async () => {
    const r = await fetchOnlineWorlds({ relays: ['wss://relay.damus.io'] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('request'))).toBe(true);
  });

  it('errors cleanly when no relays are given', async () => {
    const r = await fetchOnlineWorlds({ request: fakeRequest([]) });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('relay'))).toBe(true);
  });

  it('degrades to an empty list when the request returns no events', async () => {
    const r = await fetchOnlineWorlds({
      request: fakeRequest([]),
      relays: ['wss://relay.damus.io'],
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });
});

describe('publishOurPresence', () => {
  it('signs + fanout-publishes via injected fakes and reports accepted', async () => {
    const sign = async (unsigned) => ({ ok: true, event: { ...unsigned, id: 'a'.repeat(64), sig: 'c'.repeat(128) }, error: null });
    const publish = async (relays, event, opts) => ({ accepted: relays.length, used: relays, failed: [] });
    const r = await publishOurPresence({
      unsigned: { kind: GATEWAY_KIND, pubkey: PUB_A, tags: [['d', 'z']], content: '{}', created_at: 1 },
      sign, publish,
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
    });
    expect(r.ok).toBe(true);
    expect(r.accepted).toBe(2);
    expect(r.used).toHaveLength(2);
  });

  it('blocks cleanly with no signer (nip-07-unavailable)', async () => {
    const r = await publishOurPresence({
      unsigned: { kind: GATEWAY_KIND, pubkey: PUB_A, tags: [], content: '{}', created_at: 1 },
      publish: async () => ({ accepted: 0, used: [], failed: [] }),
      relays: ['wss://relay.damus.io'],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('nip-07-unavailable');
  });

  it('fails closed when the signer rejects', async () => {
    const sign = async () => ({ ok: false, event: null, error: 'nip-07-rejected' });
    const publish = async (relays) => ({ accepted: relays.length, used: relays, failed: [] });
    const r = await publishOurPresence({
      unsigned: { kind: GATEWAY_KIND, pubkey: PUB_A, tags: [], content: '{}', created_at: 1 },
      sign, publish, relays: ['wss://relay.damus.io'],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('nip-07-rejected');
  });

  it('fails closed when no relay accepts the event', async () => {
    const sign = async (u) => ({ ok: true, event: { ...u, id: 'a'.repeat(64), sig: 'c'.repeat(128) }, error: null });
    const publish = async (relays) => ({ accepted: 0, used: [], failed: relays });
    const r = await publishOurPresence({
      unsigned: { kind: GATEWAY_KIND, pubkey: PUB_A, tags: [], content: '{}', created_at: 1 },
      sign, publish, relays: ['wss://relay.damus.io'],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-relay-accepted');
  });
});
