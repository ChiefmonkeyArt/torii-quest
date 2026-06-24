// tests/relay-read.test.js — locks the READ-ONLY Nostr relay adapter foundation
// (src/engine/nostr/relayRead.js, NOSTR-READ, v0.2.159). Pure helpers: relay-URL
// validation, event normalisation/validation, NIP-01 filter matching, REQ/CLOSE
// frame builders, and an injected-transport read-only adapter that never signs,
// publishes, connects, or throws on malformed data. Pure module → node-testable.
import { describe, it, expect } from 'vitest';
import {
  RELAY_READ_VERBS, EVENT_FIELDS,
  validateRelayUrl, normalizeRelayEvent, validateRelayEvent, eventMatchesFilter,
  buildReqMessage, buildCloseMessage, createReadOnlyRelayAdapter,
} from '../src/engine/nostr/relayRead.js';
import * as SDK from '../src/sdk/index.js';

const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
const HEX128 = 'c'.repeat(128);

function goodEvent(over = {}) {
  return {
    id: HEX64_A,
    pubkey: HEX64_B,
    created_at: 1000,
    kind: 30000,
    tags: [['d', 'run-1'], ['t', 'torii-quest']],
    content: '{"score":120}',
    sig: HEX128,
    ...over,
  };
}

describe('validateRelayUrl', () => {
  it('accepts ws:// and wss:// URLs and returns the normalised href', () => {
    expect(validateRelayUrl('wss://relay.damus.io').valid).toBe(true);
    const r = validateRelayUrl('ws://localhost:7777');
    expect(r.valid).toBe(true);
    expect(r.url).toBe('ws://localhost:7777/');
  });

  it('rejects non-ws schemes, relative/garbage, empties, and embedded credentials', () => {
    expect(validateRelayUrl('https://relay.damus.io').valid).toBe(false);
    expect(validateRelayUrl('relay.damus.io').valid).toBe(false);
    expect(validateRelayUrl('').valid).toBe(false);
    expect(validateRelayUrl(null).valid).toBe(false);
    const creds = validateRelayUrl('wss://user:pass@relay.example.com');
    expect(creds.valid).toBe(false);
    expect(creds.errors.join()).toMatch(/credentials/);
  });
});

describe('normalizeRelayEvent', () => {
  it('coerces a wire event into the canonical shape with string tag arrays', () => {
    const e = normalizeRelayEvent({ ...goodEvent(), tags: [['d', 1], 'bad', ['t', 'x']] });
    expect(e.id).toBe(HEX64_A);
    expect(e.tags).toEqual([['d', '1'], ['t', 'x']]); // non-array tag dropped, values stringified
    expect(EVENT_FIELDS.every((f) => f in e)).toBe(true);
  });

  it('returns null for non-objects and normalises missing optionals', () => {
    expect(normalizeRelayEvent(null)).toBeNull();
    expect(normalizeRelayEvent('nope')).toBeNull();
    expect(normalizeRelayEvent([])).toBeNull();
    const e = normalizeRelayEvent({ id: HEX64_A });
    expect(e.content).toBe('');
    expect(e.sig).toBeNull();
    expect(e.tags).toEqual([]);
  });
});

describe('validateRelayEvent', () => {
  it('accepts a structurally valid event (sig optional)', () => {
    expect(validateRelayEvent(goodEvent()).valid).toBe(true);
    expect(validateRelayEvent(normalizeRelayEvent(goodEvent({ sig: undefined }))).valid).toBe(true);
  });

  it('flags bad hex, bad ints, bad tags, and bad sig shape without throwing', () => {
    expect(validateRelayEvent(goodEvent({ id: 'short' })).valid).toBe(false);
    expect(validateRelayEvent(goodEvent({ kind: -1 })).valid).toBe(false);
    expect(validateRelayEvent(goodEvent({ created_at: 1.5 })).valid).toBe(false);
    expect(validateRelayEvent(normalizeRelayEvent(goodEvent({ tags: 'nope' }))).valid).toBe(true); // normalised → []
    expect(validateRelayEvent(goodEvent({ sig: 'xyz' })).valid).toBe(false);
    expect(validateRelayEvent(null).valid).toBe(false);
  });
});

describe('eventMatchesFilter — NIP-01 semantics', () => {
  const e = normalizeRelayEvent(goodEvent());

  it('matches everything for an empty filter, nothing for a null filter', () => {
    expect(eventMatchesFilter(e, {})).toBe(true);
    expect(eventMatchesFilter(e, null)).toBe(false);
  });

  it('ANDs conditions and ORs within ids/authors/kinds', () => {
    expect(eventMatchesFilter(e, { kinds: [30000], authors: [HEX64_B] })).toBe(true);
    expect(eventMatchesFilter(e, { kinds: [1, 30000] })).toBe(true);
    expect(eventMatchesFilter(e, { kinds: [1] })).toBe(false);
    expect(eventMatchesFilter(e, { authors: ['deadbeef'] })).toBe(false);
    expect(eventMatchesFilter(e, { ids: [HEX64_A] })).toBe(true);
  });

  it('honours since/until and #tag filters', () => {
    expect(eventMatchesFilter(e, { since: 999 })).toBe(true);
    expect(eventMatchesFilter(e, { since: 1001 })).toBe(false);
    expect(eventMatchesFilter(e, { until: 1000 })).toBe(true);
    expect(eventMatchesFilter(e, { until: 999 })).toBe(false);
    expect(eventMatchesFilter(e, { '#t': ['torii-quest'] })).toBe(true);
    expect(eventMatchesFilter(e, { '#t': ['other'] })).toBe(false);
    expect(eventMatchesFilter(e, { '#d': ['run-1'] })).toBe(true);
  });
});

describe('buildReqMessage / buildCloseMessage', () => {
  it('builds a REQ frame from sub id + filters', () => {
    expect(buildReqMessage('sub1', [{ kinds: [0] }])).toEqual(['REQ', 'sub1', { kinds: [0] }]);
    expect(buildReqMessage('sub1', { kinds: [0] })).toEqual(['REQ', 'sub1', { kinds: [0] }]); // single filter wrapped
  });

  it('builds a CLOSE frame and throws on bad sub id / filters', () => {
    expect(buildCloseMessage('sub1')).toEqual(['CLOSE', 'sub1']);
    expect(() => buildReqMessage('')).toThrow();
    expect(() => buildReqMessage('sub1', [42])).toThrow();
    expect(() => buildCloseMessage(null)).toThrow();
  });

  it('exposes only read verbs (REQ/CLOSE) — no EVENT/publish frame', () => {
    expect(RELAY_READ_VERBS).toEqual(['REQ', 'CLOSE']);
    expect(RELAY_READ_VERBS).not.toContain('EVENT');
  });
});

describe('createReadOnlyRelayAdapter — injected transport, read-only', () => {
  it('normalises, validates, and filters whatever the transport returns', async () => {
    const events = [
      goodEvent(),
      goodEvent({ id: 'a'.repeat(64), kind: 1, tags: [], content: 'note' }),
      { id: 'bad' },          // fails validation → skipped
      'not-an-object',        // not an event → skipped
    ];
    const adapter = createReadOnlyRelayAdapter({ request: async () => events });
    const r = await adapter.read([{ kinds: [30000] }]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.events[0].kind).toBe(30000);
    expect(r.skipped).toHaveLength(2);
  });

  it('accepts a { events } envelope and a bare array', async () => {
    const a = createReadOnlyRelayAdapter({ request: () => ({ events: [goodEvent()] }) });
    expect((await a.read()).count).toBe(1);
    const b = createReadOnlyRelayAdapter({ request: () => [goodEvent()] });
    expect((await b.read()).count).toBe(1);
  });

  it('degrades safely with no transport, a thrown request, or a bad shape — never throws', async () => {
    const none = await createReadOnlyRelayAdapter().read();
    expect(none.ok).toBe(false);
    expect(none.errors.join()).toMatch(/no transport/);

    const threw = await createReadOnlyRelayAdapter({ request: () => { throw new Error('boom'); } }).read();
    expect(threw.ok).toBe(false);
    expect(threw.errors.join()).toMatch(/request failed/);

    const badShape = await createReadOnlyRelayAdapter({ request: () => 42 }).read();
    expect(badShape.ok).toBe(false);
    expect(badShape.errors.join()).toMatch(/non-event-list/);
  });

  it('exposes NO publish/sign/send/connect/close method and is frozen', () => {
    const adapter = createReadOnlyRelayAdapter({ request: () => [] });
    expect(adapter.readOnly).toBe(true);
    for (const key of ['publish', 'sign', 'send', 'connect', 'close', 'write', 'emit']) {
      expect(adapter).not.toHaveProperty(key);
    }
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(() => { adapter.publish = () => {}; }).toThrow();
  });
});

describe('SDK exposure', () => {
  it('exposes relayRead at the experimental SDK tier', () => {
    expect(SDK.SDK_SURFACE.relayRead.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.relayRead.createReadOnlyRelayAdapter).toBe('function');
    expect(typeof SDK.relayRead.eventMatchesFilter).toBe('function');
  });
});
